import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { chooseName } from "../src/lib/platform";
import type { Target } from "../src/lib/platform";
import { createLimiter } from "../src/lib/queue";
import { isMediaName } from "../src/lib/formats";
import type { Settings } from "../src/lib/types";
import type { NativeOutput, NativeSource } from "../src/lib/native-contract";

interface Source { meta: NativeSource; path: string; root: string }
interface Output { sourceId: string; temp: string; final: string; overwrite: boolean; validated: boolean }
const key = (p: string) => process.platform === "win32" ? p.toLowerCase() : p;
const segment = (s: string) => {
  if (typeof s !== "string" || !s.trim() || /[\\/:*?"<>|]/.test(s) || /^\.+$/.test(s) || /[. ]$/.test(s)) throw new Error("Ungültiger Ordner- oder Dateiname.");
  return s;
};
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";

/** Only dialog/drop registered sources and planned outputs can be accessed through IPC. */
export class NativeStore {
  sources = new Map<string, Source>();
  outputs = new Map<string, Output>();
  /**
   * Vorschaubilder, die FFmpeg aus einer Quelle geholt hat.
   *
   * Nur der Hauptprozess kennt die Pfade; der Renderer bekommt eine Adresse auf
   * denselben Ursprung (`wandler-media://preview/<id>`). Genau wie bei Quellen
   * gilt: Wer nicht registriert ist, ist nicht abrufbar.
   */
  previews = new Map<string, string>();
  private plans = new Map<string, { target: Target; dir: string }>();
  private lockedNames = new Set<string>();
  private lock = createLimiter(1);
  custom: string | null = null;

  getSource(id: string): Source {
    const src = this.sources.get(id);
    if (!src) throw new Error("Die Quelldatei ist nicht registriert. Bitte erneut hinzufügen.");
    return src;
  }
  setPreview(sourceId: string, file: string): void {
    this.previews.set(sourceId, file);
  }
  getPreview(id: string): string {
    const file = this.previews.get(id);
    if (!file) throw new Error("Für diese Datei gibt es kein Vorschaubild.");
    return file;
  }
  getOutput(id: string): Output {
    const out = this.outputs.get(id);
    if (!out) throw new Error("Die Ausgabe ist nicht geöffnet.");
    return out;
  }
  async add(paths: string[], skip: string): Promise<NativeSource[]> {
    const found: NativeSource[] = [];
    const walk = async (file: string, root: string, relDirs: string[], filter: boolean) => {
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) return; // no cycles or traversal outside a selected tree
      if (stat.isDirectory()) {
        for (const name of (await fs.readdir(file)).sort()) {
          if (name.startsWith(".") || (!relDirs.length && name.toLowerCase() === skip.toLowerCase())) continue;
          const child = path.join(file, name);
          const childStat = await fs.lstat(child);
          await walk(child, root, childStat.isDirectory() ? [...relDirs, name] : relDirs, true);
        }
      } else if (stat.isFile() && (!filter || isMediaName(file))) {
        const real = await fs.realpath(file);
        const existing = [...this.sources.values()].find((s) => key(s.path) === key(real));
        if (existing) { found.push(existing.meta); return; }
        const id = randomUUID();
        const meta: NativeSource = { id, name: path.basename(file), size: stat.size, lastModified: stat.mtimeMs, relDirs, previewUrl: `wandler-media://source/${id}` };
        this.sources.set(id, { meta, path: real, root });
        found.push(meta);
      }
    };
    for (const file of paths) {
      const stat = await fs.lstat(file);
      await walk(file, stat.isDirectory() ? file : path.dirname(file), [], false);
    }
    return found;
  }
  async plan(ids: string[], settings: Settings): Promise<[string, Target][]> {
    if (settings.destination === "custom" && !this.custom) throw new Error("Bitte den Zielordner erneut wählen.");
    const sub = segment(settings.outFolderName.trim() || "Konvertiert");
    return ids.map((id) => {
      const src = this.getSource(id);
      const dir = settings.destination === "custom" ? this.custom! : path.join(src.root, sub, ...src.meta.relDirs.map(segment));
      const target: Target = { kind: "folder", folder: { kind: "custom", id: randomUUID() }, sub: [] };
      this.plans.set(id, { target, dir });
      return [id, target];
    });
  }
  open(target: Target, sourceId: string, ext: string, settings: Settings): Promise<NativeOutput | null> {
    return this.lock(async () => {
      if (!/^(mp4|mov|mkv|webm|ts|mp3|aac|flac|wav|ogg)$/.test(ext)) throw new Error("Ungültiges Ausgabeformat.");
      if (!["number", "skip", "overwrite"].includes(settings.collision)) throw new Error("Ungültige Kollisionsregel.");
      const plan = this.plans.get(sourceId);
      if (!plan || JSON.stringify(target) !== JSON.stringify(plan.target)) throw new Error("Der Zielordner wurde nicht vorbereitet.");
      const src = this.getSource(sourceId);
      await fs.mkdir(plan.dir, { recursive: true });
      const dir = await fs.realpath(plan.dir);
      const entries = new Set((await fs.readdir(dir)).map(key));
      const base = segment(path.parse(src.meta.name).name);
      const first = path.join(dir, `${base}.${ext}`);
      let same = key(first) === key(src.path);
      try {
        const [a, b] = await Promise.all([fs.stat(first), fs.stat(src.path)]);
        same ||= a.dev === b.dev && a.ino === b.ino;
      } catch (e) { if (!missing(e)) throw e; }
      const collision = this.lockedNames.has(key(first)) && settings.collision === "overwrite" ? "number" : settings.collision;
      const name = chooseName(base, ext, (n) => entries.has(key(n)) || this.lockedNames.has(key(path.join(dir, n))), collision, same);
      if (!name) return null;
      const final = path.join(dir, name);
      const id = randomUUID();
      const temp = path.join(dir, `.wandler-${id}.partial.${ext}`);
      const handle = await fs.open(temp, "wx");
      await handle.close();
      this.lockedNames.add(key(final));
      this.outputs.set(id, { sourceId, temp, final, overwrite: collision === "overwrite" && !same, validated: false });
      return { id, place: dir };
    });
  }
  async finish(id: string): Promise<number> {
    const out = this.getOutput(id);
    if (!out.validated) throw new Error("Die Ausgabe wurde noch nicht geprüft.");
    const handle = await fs.open(out.temp, "r+");
    let size: number;
    try { size = (await handle.stat()).size; await handle.sync(); } finally { await handle.close(); }
    if (!size) throw new Error("Die Ausgabe ist leer.");
    // Same-volume atomic replacement. Number/skip never replace a concurrent writer.
    if (out.overwrite) await fs.rename(out.temp, out.final);
    else { await fs.link(out.temp, out.final); await fs.unlink(out.temp).catch(() => undefined); }
    this.lockedNames.delete(key(out.final));
    this.outputs.delete(id);
    return size;
  }
  async discard(id: string): Promise<void> {
    const out = this.outputs.get(id);
    if (!out) return;
    await fs.unlink(out.temp).catch((e) => { if (!missing(e)) throw e; });
    this.lockedNames.delete(key(out.final));
    this.outputs.delete(id);
  }
}

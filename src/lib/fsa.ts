/* eslint-disable @typescript-eslint/no-explicit-any */
import { isMediaName } from "./formats";
import { uid } from "./format";
import { idbDelete, idbGet, idbSet } from "./storage";
import { baseName } from "./format";
import { OutputWriteError, transactionalStream } from "./io";
import { createLimiter } from "./queue";
import { chooseName } from "./platform";
import type { FolderRef, OutputSink, PlatformFS, Target } from "./platform";
import type { Settings, SourceFile } from "./types";

type DirHandle = FileSystemDirectoryHandle;
type FileHandle = FileSystemFileHandle;

const w = (typeof window !== "undefined" ? window : {}) as any;

/** Dateisystem-Zugriff wie in einer nativen App (Chrome, Edge, später Windows-App). */
export const fsaSupported: boolean =
  typeof w.showDirectoryPicker === "function" && typeof w.showOpenFilePicker === "function";

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

function sortSources(list: SourceFile[]): SourceFile[] {
  return list.sort((a, b) => collator.compare(a.relDirs.join("/") + "/" + a.name, b.relDirs.join("/") + "/" + b.name));
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "AbortError" || e.name === "NotAllowedError");
}

/* ───────────── Einlesen ───────────── */

async function walk(dir: DirHandle, rel: string[], root: DirHandle, skip: string, acc: SourceFile[]) {
  for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind === "directory") {
      if (name.startsWith(".")) continue;
      if (rel.length === 0 && name.toLowerCase() === skip.toLowerCase()) continue;
      await walk(handle as DirHandle, [...rel, name], root, skip, acc);
    } else if (isMediaName(name)) {
      try {
        const fh = handle as FileHandle;
        acc.push({ id: uid(), file: await fh.getFile(), name, handle: fh, root, relDirs: rel });
      } catch (e) {
        throw new Error(`„${name}“ konnte nicht eingelesen werden. Prüfe die Verbindung zum Quellordner. ${e instanceof Error ? e.message : ""}`);
      }
    }
  }
}

async function fromDirectory(dir: DirHandle, skip: string): Promise<SourceFile[]> {
  const acc: SourceFile[] = [];
  await walk(dir, [], dir, skip, acc);
  await addKnownFolder(dir).catch(() => undefined);
  return acc;
}

function fromFiles(files: File[], directory: boolean): SourceFile[] {
  const out: SourceFile[] = [];
  for (const f of files) {
    if (directory && !isMediaName(f.name)) continue;
    const rel = (f as any).webkitRelativePath as string | undefined;
    const relDirs = rel ? rel.split("/").slice(1, -1) : [];
    out.push({ id: uid(), file: f, name: f.name, relDirs });
  }
  return sortSources(out);
}

function pickViaInput(directory: boolean): Promise<SourceFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (directory) (input as any).webkitdirectory = true;
    input.addEventListener("change", () => resolve(fromFiles(Array.from(input.files ?? []), directory)));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

export async function pickFiles(): Promise<SourceFile[]> {
  if (!fsaSupported) return pickViaInput(false);
  let handles: FileHandle[];
  try { handles = await w.showOpenFilePicker({ multiple: true, id: "wandler-quelle" }); }
  catch (e) { if (isAbort(e)) return []; return pickViaInput(false); }
  const out: SourceFile[] = [];
  for (const h of handles) {
    try { out.push({ id: uid(), file: await h.getFile(), name: h.name, handle: h, relDirs: [] }); }
    catch { throw new Error(`„${h.name}“ konnte nicht eingelesen werden. Bitte die Verbindung zur Quelle prüfen und erneut hinzufügen.`); }
  }
  return sortSources(out);
}

export async function pickFolder(skip: string): Promise<SourceFile[]> {
  if (!fsaSupported) return pickViaInput(true);
  let dir: DirHandle;
  try { dir = await w.showDirectoryPicker({ id: "wandler-quelle", mode: "readwrite" }); }
  catch (e) { if (isAbort(e)) return []; return pickViaInput(true); }
  return sortSources(await fromDirectory(dir, skip));
}

/** Muss synchron im drop-Handler gestartet werden (DataTransfer wird danach ungültig). */
export async function collectFromDrop(dt: DataTransfer, skip: string): Promise<SourceFile[]> {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  const plainFiles = Array.from(dt.files ?? []);

  if (fsaSupported && items.length && typeof (items[0] as any).getAsFileSystemHandle === "function") {
    const pending = items.map((i) => (i as any).getAsFileSystemHandle() as Promise<FileSystemHandle | null>);
    const handles = await Promise.all(pending.map((p) => Promise.resolve(p).catch(() => null)));
    const acc: SourceFile[] = [];
    for (const h of handles) {
      if (!h) continue;
      try {
        if (h.kind === "directory") {
          acc.push(...(await fromDirectory(h as DirHandle, skip)));
        } else {
          const fh = h as FileHandle;
          acc.push({ id: uid(), file: await fh.getFile(), name: fh.name, handle: fh, relDirs: [] });
        }
      } catch (e) {
        throw new Error(`„${h.name}“ konnte nicht vollständig gelesen werden. Bitte die Verbindung zur Quelle prüfen. ${e instanceof Error ? e.message : ""}`);
      }
    }
    if (acc.length) return sortSources(acc);
  }
  return fromFiles(plainFiles, false);
}

/* ───────────── Bekannte Ordner (Gedächtnis des smarten Ziels) ───────────── */

interface KnownFolder {
  name: string;
  handle: DirHandle;
}

async function getKnownFolders(): Promise<KnownFolder[]> {
  return (await idbGet<KnownFolder[]>("known-folders")) ?? [];
}

async function addKnownFolder(dir: DirHandle) {
  const list = await getKnownFolders();
  for (const k of list) {
    try {
      if (await k.handle.isSameEntry(dir)) return;
    } catch {
      /* Handle ungültig */
    }
  }
  list.push({ name: dir.name, handle: dir });
  await idbSet("known-folders", list.slice(-40));
}

/* ───────────── Ordner-Register: Ort statt Gegenstand ───────────── */

/**
 * Die Handles leben hier, nicht im `Target`. Das Target trägt nur eine id und
 * kann dadurch über Prozessgrenzen; auf dem Desktop wird dieselbe id ein Pfad.
 */
const folders = new Map<string, DirHandle>();
const folderIds = new WeakMap<DirHandle, string>();
let folderSeq = 0;

function internFolder(handle: DirHandle, kind: FolderRef["kind"]): FolderRef {
  let id = folderIds.get(handle);
  if (!id) {
    id = `f${++folderSeq}`;
    folderIds.set(handle, id);
    folders.set(id, handle);
  }
  return { kind, id };
}

function resolveFolder(ref: FolderRef): DirHandle | null {
  return folders.get(ref.id) ?? null;
}

export async function forgetFolders() {
  await idbDelete("known-folders");
  await idbDelete("custom-destination");
}

export async function getCustomDestination(): Promise<DirHandle | null> {
  return (await idbGet<DirHandle>("custom-destination")) ?? null;
}

export async function chooseCustomDestination(): Promise<DirHandle | null> {
  if (!fsaSupported) return null;
  try {
    const dir: DirHandle = await w.showDirectoryPicker({ id: "wandler-ziel", mode: "readwrite", startIn: "videos" });
    await idbSet("custom-destination", dir);
    return dir;
  } catch {
    return null;
  }
}

async function ensureWritable(dir: DirHandle): Promise<boolean> {
  const d = dir as any;
  try {
    if (!d.queryPermission) return true;
    if ((await d.queryPermission({ mode: "readwrite" })) === "granted") return true;
    return (await d.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

/* ───────────── Zielplanung ───────────── */

export class TargetAccessError extends Error {
  constructor(message = "Auf den Zielordner kann nicht geschrieben werden. Wähle bitte einen anderen Ordner.") {
    super(message);
    this.name = "TargetAccessError";
  }
}

async function pathWithin(dir: DirHandle, handle: FileHandle): Promise<string[] | null> {
  try {
    return await dir.resolve(handle);
  } catch {
    return null;
  }
}

/**
 * Smartes Ziel:
 * 1. Dateien aus Ordnern → „Konvertiert“ im hinzugefügten Ordner (Unterordner gespiegelt).
 * 2. Einzelne Dateien → bekannte Quellordner, wenn ein passender Handle existiert.
 * 3. Andernfalls → Downloads. Ein Zielordner wird nie ungefragt abgefragt.
 */
export async function planTargets(sources: SourceFile[], settings: Settings): Promise<Map<string, Target>> {
  const result = new Map<string, Target>();
  const out = settings.outFolderName.trim() || "Konvertiert";
  const downloads = () => sources.forEach((s) => !result.has(s.id) && result.set(s.id, { kind: "download" }));

  if (!fsaSupported) {
    downloads();
    return result;
  }

  if (settings.destination === "custom") {
    const dir = await getCustomDestination();
    if (!dir) throw new TargetAccessError("Der gespeicherte Zielordner ist nicht mehr verfügbar. Wähle bitte einen neuen Ordner.");
    if (!(await ensureWritable(dir))) throw new TargetAccessError();
    sources.forEach((s) => result.set(s.id, { kind: "folder", folder: internFolder(dir, "custom"), sub: [] }));
    return result;
  }

  const known = await getKnownFolders();
  const unresolved: SourceFile[] = [];
  for (const s of sources) {
    if (s.root) {
      result.set(s.id, { kind: "folder", folder: internFolder(s.root, "source"), sub: [out, ...s.relDirs] });
      continue;
    }
    let matched = false;
    if (s.handle) {
      for (const k of known) {
        const path = await pathWithin(k.handle, s.handle);
        if (path) {
          result.set(s.id, { kind: "folder", folder: internFolder(k.handle, "known"), sub: [out, ...path.slice(0, -1)] });
          matched = true;
          break;
        }
      }
    }
    if (!matched) unresolved.push(s);
  }

  // Browser security deliberately does not expose a file's parent folder.
  // Never open an unexpected folder picker when the user presses Convert.
  unresolved.forEach((s) => result.set(s.id, { kind: "download" }));

  // Schreibrechte prüfen (einmal je Ordner)
  const checked = new Map<DirHandle, boolean>();
  for (const t of result.values()) {
    if (t.kind !== "folder") continue;
    const dir = resolveFolder(t.folder);
    if (!dir) throw new TargetAccessError();
    let ok = checked.get(dir);
    if (ok === undefined) {
      ok = await ensureWritable(dir);
      checked.set(dir, ok);
    }
    if (!ok) throw new TargetAccessError();
  }
  return result;
}

/* ───────────── Ausgabe ───────────── */

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "Datei";

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Gibt `null` zurück, wenn die Datei übersprungen werden soll. */
async function openUnsafe(target: Target, source: SourceFile, ext: string, settings: Settings): Promise<OutputSink | null> {
  const base = sanitize(baseName(source.name));

  if (target.kind === "download") {
    const name = `${base}.${ext}`;
    return {
      place: "Download angefordert",
      delivery: "download",
      async finish(blob) {
        if (!blob?.size) throw new OutputWriteError("Die Ausgabe ist leer.");
        triggerDownload(blob, name);
        return blob.size;
      },
      async discard() {
        /* nichts geschrieben */
      },
    };
  }

  const root = resolveFolder(target.folder);
  if (!root) throw new TargetAccessError("Der Zielordner ist nicht mehr verfügbar. Wähle bitte einen neuen Ordner.");

  let dir = root;
  for (const part of target.sub) dir = await dir.getDirectoryHandle(sanitize(part), { create: true });

  /* Ein Blick in den Ordner genügt – danach ist die Namensfrage synchron entscheidbar. */
  const entries = new Set<string>();
  for await (const [name] of (dir as any).entries() as AsyncIterable<[string, unknown]>) entries.add(name);

  let sameAsSource = false;
  if (source.handle && [...entries].some((n) => n.toLocaleLowerCase() === `${base}.${ext}`.toLocaleLowerCase())) {
    try {
      sameAsSource = await (await dir.getFileHandle(`${base}.${ext}`)).isSameEntry(source.handle);
    } catch {
      /* ignorieren */
    }
  }
  const held = new Set<string>();
  for (const r of reservations) {
    if (await r.dir.isSameEntry(dir)) held.add(r.name.toLocaleLowerCase());
  }
  const exists = (n: string) => [...entries].some((e) => e.toLocaleLowerCase() === n.toLocaleLowerCase()) || held.has(n.toLocaleLowerCase());
  const collision = held.has(`${base}.${ext}`.toLocaleLowerCase()) && settings.collision === "overwrite" ? "number" : settings.collision;
  const name = chooseName(base, ext, exists, collision, sameAsSource);
  if (!name) return null;

  const existed = [...entries].some((e) => e.toLocaleLowerCase() === name.toLocaleLowerCase());
  const reservation = { dir, name };
  reservations.add(reservation);
  const release = () => reservations.delete(reservation);
  try {
    const fh = await dir.getFileHandle(name, { create: true });
    const transaction = transactionalStream(await fh.createWritable());
    const place = [root.name, ...target.sub].join(" / ");
    let committed = false;
    return {
      writable: transaction.writable,
      delivery: "saved",
      place,
      async finish() {
        try {
          await transaction.commit();
          committed = true;
          const size = (await fh.getFile()).size;
          if (!size) throw new OutputWriteError("Die Ausgabe ist leer.");
          release();
          return size;
        } catch (e) {
          throw e instanceof OutputWriteError ? e : new OutputWriteError(e);
        }
      },
      async discard() {
        await transaction.abort();
        // Never delete an existing destination, even after a failed overwrite.
        if (!existed && !committed) await dir.removeEntry(name).catch(() => undefined);
        release();
      },
    };
  } catch (e) {
    release();
    throw e;
  }
}

const reservations = new Set<{ dir: DirHandle; name: string }>();
const openLimit = createLimiter(1);
export function open(target: Target, source: SourceFile, ext: string, settings: Settings): Promise<OutputSink | null> {
  return openLimit(async () => {
    try { return await openUnsafe(target, source, ext, settings); }
    catch (e) { throw new OutputWriteError(e); }
  });
}

/** Die Web-Implementierung der Naht: File System Access hinter `PlatformFS`. */
export const webFS: PlatformFS = {
  supported: fsaSupported,
  pickFiles,
  pickFolder,
  collectFromDrop,
  planTargets,
  open,
  async chooseCustomDestination() {
    const dir = await chooseCustomDestination();
    return dir?.name ?? null;
  },
  forgetFolders,
};

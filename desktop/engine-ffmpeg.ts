import path from "node:path";
import * as fs from "node:fs/promises";
import { buildFfmpegArgs } from "../src/lib/ffmpeg";
import { devicePreset, isIpod } from "../src/lib/compatibility";
import { resolveJob } from "../src/lib/job";
import type { Capabilities, HardwareInfo, MediaInfo } from "../src/lib/types";
import type { NativeConversion } from "../src/lib/native-contract";
import type { ProbeResult } from "../src/lib/engine";
import { candidates } from "./ffmpeg-locate";
import type { DesktopPlatform, FfmpegDirs } from "./ffmpeg-locate";
import { run } from "./process";
import type { NativeStore } from "./fs-node";

const software: HardwareInfo = { gpu: "", vendor: "none", encoder: "Software (CPU)", available: false, source: "ffmpeg" };
interface Tools { ffmpeg: string; ffprobe: string; encoders: string }
interface Stream {
  codec_type?: string; codec_name?: string; profile?: string; level?: number;
  width?: number; height?: number; sample_aspect_ratio?: string; pix_fmt?: string; avg_frame_rate?: string; r_frame_rate?: string;
  bit_rate?: string; channels?: number; sample_rate?: string;
  side_data_list?: { rotation?: number }[]; tags?: { rotate?: string }; color_transfer?: string;
}
interface Probe { format?: { format_name?: string; duration?: string; size?: string; tags?: Record<string, string> }; streams?: Stream[] }
const number = (s: unknown) => Number.isFinite(Number(s)) ? Number(s) : 0;
const ratio = (s?: string) => { const [a, b] = (s ?? "0/1").split("/").map(Number); return b ? a / b : 0; };
const codec = (s?: string) => ({ h264: "avc", hevc: "hevc", pcm_s16le: "pcm-s16" })[s ?? ""] ?? s ?? "";

/**
 * Die beschreibenden Angaben einer Datei in die Sprache der App übersetzen.
 * Gelesen wird, was gängige Werkzeuge schreiben – inklusive der Serienfelder,
 * die iTunes und Plex verwenden.
 */
export function readTags(probe: Probe): MediaInfo["tags"] {
  const t = probe.format?.tags ?? {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = Object.entries(t).find(([name]) => name.toLowerCase() === k)?.[1];
      if (v && String(v).trim()) return String(v).trim();
    }
    return undefined;
  };
  const tags: MediaInfo["tags"] = {
    title: pick("title"),
    artist: pick("artist", "album_artist", "performer"),
    year: pick("date", "year")?.match(/\d{4}/)?.[0],
    genre: pick("genre"),
    show: pick("show", "tvshow"),
    season: pick("season_number"),
    episode: pick("episode_sort", "episode_id"),
    episodeTitle: pick("episode_name"),
    description: pick("description", "comment"),
  };
  return Object.values(tags).some(Boolean) ? tags : undefined;
}

export function mediaInfo(probe: Probe): MediaInfo {
  const v = probe.streams?.find((s) => s.codec_type === "video");
  const a = probe.streams?.find((s) => s.codec_type === "audio");
  const rotation = v ? ((number(v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? v.tags?.rotate) % 360) + 360) % 360 : 0;
  const sar = ratio(v?.sample_aspect_ratio?.replace(":", "/")) || 1;
  const displayWidth = v?.width ? Math.round(v.width * sar) : 0;
  const swapped = rotation === 90 || rotation === 270;
  return {
    format: probe.format?.format_name ?? "", duration: number(probe.format?.duration), size: number(probe.format?.size),
    video: v ? { codec: codec(v.codec_name), width: (swapped ? v.height : displayWidth) ?? 0, height: (swapped ? displayWidth : v.height) ?? 0, rotation, fps: ratio(v.avg_frame_rate) || ratio(v.r_frame_rate), bitrate: number(v.bit_rate), hdr: ["smpte2084", "arib-std-b67"].includes(v.color_transfer ?? "") } : undefined,
    audio: a ? { codec: codec(a.codec_name), channels: a.channels ?? 0, sampleRate: number(a.sample_rate), bitrate: number(a.bit_rate) } : undefined,
    tags: readTags(probe),
  };
}

export function assertIpod(probe: Probe): void {
  const v = probe.streams?.find((s) => s.codec_type === "video");
  const a = probe.streams?.find((s) => s.codec_type === "audio");
  if (!v || v.codec_name !== "h264" || !/baseline/i.test(v.profile ?? "") || v.level !== 30 || v.pix_fmt !== "yuv420p" || !v.width || !v.height || v.width > 480 || v.height > 320 || ratio(v.avg_frame_rate) > 30.01)
    throw new Error("Die erzeugte Videospur erfüllt das iPod-touch-1G-Profil nicht. Die Ausgabe wird nicht übernommen.");
  if (a && (a.codec_name !== "aac" || a.profile !== "LC" || number(a.sample_rate) !== 44100 || a.channels !== 2))
    throw new Error("Die erzeugte Tonspur ist nicht AAC-LC, 44,1 kHz, Stereo. Die Ausgabe wird nicht übernommen.");
}

export class FfmpegEngine {
  private toolsPromise?: Promise<Tools>;
  private hardwarePromise?: Promise<HardwareInfo>;
  active = new Map<string, AbortController>();
  private pending = new Map<string, Promise<void>>();
  async stopAll() {
    for (const ac of this.active.values()) ac.abort();
    await Promise.allSettled([...this.pending.values()]);
  }
  constructor(private store: NativeStore, private dirs: FfmpegDirs, private progress: (id: string, fraction: number, seconds: number) => void) {}
  tools(): Promise<Tools> {
    if (!this.toolsPromise) this.toolsPromise = this.locate().catch((e) => { this.toolsPromise = undefined; throw e; });
    return this.toolsPromise;
  }
  private async locate(): Promise<Tools> {
    const list = [process.env.FFMPEG_PATH, "ffmpeg", ...candidates(process.platform as DesktopPlatform, this.dirs).map((c) => c.path)].filter((s): s is string => !!s);
    if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, "Wandler", "ffmpeg", "bin", "ffmpeg.exe"));
    for (const ffmpeg of list) {
      try {
        await run(ffmpeg, ["-version"], { timeout: 8000 });
        const ffprobe = ffmpeg === "ffmpeg" ? "ffprobe" : path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
        await run(ffprobe, ["-version"], { timeout: 8000 });
        const { stdout } = await run(ffmpeg, ["-hide_banner", "-encoders"], { timeout: 8000 });
        if (!/\blibx264\b/.test(stdout) || !/\baac\b/.test(stdout)) continue;
        return { ffmpeg, ffprobe, encoders: stdout };
      } catch { /* another candidate */ }
    }
    throw new Error("FFmpeg und FFprobe mit libx264/AAC fehlen. Bitte den Installer erneut ausführen (Internet erforderlich) oder einen vollständigen FFmpeg-Build installieren und die App neu starten.");
  }
  async init(): Promise<Capabilities> {
    const { encoders } = await this.tools();
    const video: Capabilities["video"] = ["h264"];
    for (const [id, encoder] of [["h265", "libx265"], ["av1", "libsvtav1"], ["vp9", "libvpx-vp9"], ["vp8", "libvpx"]] as const) {
      if (encoders.includes(encoder)) video.push(id);
    }
    const audio: Capabilities["audio"] = ["aac", "pcm"];
    for (const [id, encoder] of [["mp3", "libmp3lame"], ["flac", "flac"], ["opus", "libopus"], ["vorbis", "libvorbis"]] as const) {
      if (encoders.includes(encoder)) audio.push(id);
    }
    // Subtitle editing/burning is not exposed until stream selection is implemented.
    return { ready: true, video, audio, subtitles: false, metadata: true, cover: true };
  }
  hardware(): Promise<HardwareInfo> {
    if (!this.hardwarePromise) this.hardwarePromise = this.checkHardware().catch(() => software);
    return this.hardwarePromise;
  }
  private async checkHardware(): Promise<HardwareInfo> {
    const tools = await this.tools();
    for (const [vendor, encoder, name] of [["nvidia", "h264_nvenc", "NVENC"], ["intel", "h264_qsv", "Quick Sync"], ["amd", "h264_amf", "AMF"]] as const) {
      if (!tools.encoders.includes(encoder)) continue;
      try {
        await run(tools.ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=size=128x128:rate=1", "-frames:v", "1", "-c:v", encoder, "-f", "null", "-"], { timeout: 10000 });
        return { gpu: "", vendor, encoder: name, available: true, source: "ffmpeg" };
      } catch { /* compiled in is not the same as usable */ }
    }
    return software;
  }
  /** Holt das Titelbild als Datei neben die vorläufige Ausgabe. Scheitert es, gibt es keins. */
  private async coverFile(url: string | undefined, temp: string, signal: AbortSignal): Promise<string | undefined> {
    if (!url) return undefined;
    if (!url.startsWith("https://")) throw new Error("Das Titelbild muss von einer verschlüsselten Adresse kommen.");
    const response = await fetch(url, { signal, redirect: "follow" });
    if (!response.ok) throw new Error(`Das Titelbild konnte nicht geladen werden (${response.status}).`);
    const type = response.headers.get("content-type") ?? "";
    if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new Error("Die Adresse liefert kein Bild.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 8_000_000) throw new Error("Das Titelbild ist zu groß (mehr als 8 MB).");
    const file = `${temp}.cover`;
    await fs.writeFile(file, bytes);
    return file;
  }

  private async read(file: string, signal?: AbortSignal): Promise<Probe> {
    const { ffprobe } = await this.tools();
    const { stdout } = await run(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { timeout: 30000, signal });
    return JSON.parse(stdout) as Probe;
  }
  /**
   * Ein Standbild aus der Quelle holen.
   *
   * Der Browser kann längst nicht jedes Format abspielen – Matroska, AVI, TS
   * und vieles mehr bleiben schwarz. FFmpeg kann es lesen, also holt es ein
   * Bild: Damit sieht der Nutzer schon in der Liste, was er vor sich hat, und
   * der Ausschnitt ist kein Blindflug mehr. Scheitert es, bleibt es beim
   * Platzhalter – ein fehlendes Vorschaubild darf das Hinzufügen nie aufhalten.
   */
  private async preview(sourceId: string, info: MediaInfo, signal?: AbortSignal): Promise<string | undefined> {
    if (!info.video) return undefined;
    try {
      const { ffmpeg } = await this.tools();
      const src = this.store.getSource(sourceId);
      const at = info.duration > 2 ? Math.min(10, info.duration / 3) : 0;
      const dir = path.join(this.dirs.userData, "previews");
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${sourceId}.jpg`);
      await run(ffmpeg, ["-nostdin", "-v", "error", "-y", "-ss", at.toFixed(3), "-i", src.path, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "3", file], { timeout: 30000, signal });
      this.store.setPreview(sourceId, file);
      return `wandler-media://preview/${sourceId}`;
    } catch {
      return undefined;
    }
  }
  async probe(id: string, signal?: AbortSignal): Promise<ProbeResult> {
    const src = this.store.getSource(id);
    const info = mediaInfo(await this.read(src.path));
    if (!info.audio && !info.video) return { health: { state: "broken", reason: "Keine lesbare Bild- oder Tonspur gefunden." } };
    return { info, health: { state: "ok" }, thumb: await this.preview(id, info, signal) };
  }
  cancel(id: string) { this.active.get(id)?.abort(); }
  async convert(req: NativeConversion): Promise<void> {
    const out = this.store.getOutput(req.outputId);
    if (out.sourceId !== req.sourceId || this.active.has(req.outputId)) throw new Error("Ungültiger oder bereits laufender Auftrag.");
    const ac = new AbortController();
    this.active.set(req.outputId, ac);
    let settled!: () => void;
    this.pending.set(req.outputId, new Promise<void>((resolve) => { settled = resolve; }));
    const passlog = `${out.temp}.pass`;
    try {
      const tools = await this.tools();
      const src = this.store.getSource(req.sourceId);
      const info = mediaInfo(await this.read(src.path, ac.signal));
      const preset = devicePreset(req.preset);
      const job = resolveJob(preset, info, req.adj);
      const hw = req.hardware === "auto" && !isIpod(preset) ? await this.hardware() : software;
      /*
       * Das Titelbild kommt aus dem Netz und wird hier zu einer Datei – FFmpeg
       * braucht einen Pfad. Geschrieben wird sie neben die vorläufige Ausgabe
       * und im `finally` wieder entfernt; scheitert der Download, wird ohne
       * Bild weitergearbeitet, aber nicht ohne es zu sagen (`coverNote`).
       */
      const cover = await this.coverFile(req.metadata?.poster?.url, out.temp, ac.signal);
      const encode = async (useHw: boolean) => {
        const calls = buildFfmpegArgs(preset, hw, useHw, src.path, req.adj, {
          output: out.temp,
          nullDevice: process.platform === "win32" ? "NUL" : "/dev/null",
          info,
          passlogfile: passlog,
          metadata: req.metadata,
          cover,
        });
        for (const [index, call] of calls.entries()) {
          await run(tools.ffmpeg, ["-nostdin", "-progress", "pipe:1", "-nostats", ...call.slice(1)], {
            signal: ac.signal,
            onLine: (line) => {
              if (!line.startsWith("out_time_us=")) return;
              const seconds = number(line.slice(12)) / 1_000_000;
              const fraction = job.duration > 0 ? Math.min(1, seconds / job.duration) : 0;
              this.progress(req.outputId, (index + fraction) / calls.length, seconds);
            },
          });
        }
      };
      try { await encode(hw.available); }
      catch (e) {
        // Never retry a storage failure or a cancellation as damaged media.
        if (!hw.available || ac.signal.aborted || /space|quota|permission|denied|I\/O|input\/output|network/i.test(String(e))) throw e;
        await encode(false);
      }
      const result = await this.read(out.temp, ac.signal);
      const actual = mediaInfo(result);
      if (!actual.audio && !actual.video) throw new Error("Die Ausgabe enthält keine Medienspuren.");
      if (info.video && preset.video.codec !== "none" && !actual.video && ["mp4", "mov", "mkv", "webm", "ts"].includes(preset.container)) throw new Error("Die Bildspur fehlt in der Ausgabe.");
      if (info.audio && preset.audio.codec !== "none" && !actual.audio) throw new Error("Die Tonspur fehlt in der Ausgabe.");
      if (job.duration && actual.duration < job.duration - Math.max(1, job.duration * 0.01)) throw new Error("Die Ausgabe ist kürzer als erwartet. Sie wird nicht als vollständige Datei gespeichert.");
      if (isIpod(preset)) assertIpod(result);
      /*
       * Ein ausgefülltes Formular ist kein Ergebnis. Wenn ein Titel eingetragen
       * war und die Ausgabe keinen trägt, wird das nicht als Erfolg verbucht.
       */
      const wantedTitle = req.metadata?.episodeTitle?.trim() || req.metadata?.title?.trim();
      if (wantedTitle && preset.container !== "ts") {
        const written = readTags(result)?.title;
        if (written !== wantedTitle) throw new Error("Die Metadaten wurden nicht in die Datei geschrieben. Die Ausgabe wird nicht übernommen.");
      }
      if (ac.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
      out.validated = true;
    } finally {
      this.active.delete(req.outputId);
      this.pending.delete(req.outputId);
      settled();
      for (const suffix of ["-0.log", "-0.log.mbtree"]) await fs.unlink(passlog + suffix).catch(() => undefined);
      await fs.unlink(`${out.temp}.cover`).catch(() => undefined);
    }
  }
}

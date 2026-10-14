/**
 * Ein Auftrag, eine Wahrheit.
 *
 * Preset + Analyse der Datei + Anpassungen der Datei ergeben den `Job`. Aus dem
 * Job macht die Web-Engine Mediabunny-Optionen und die Desktop-App ein
 * FFmpeg-Argument-Array. Beide denken dadurch identisch – vorher bauten
 * `engine.ts` und `ffmpeg.ts` dieselbe Logik zweimal und drifteten auseinander.
 *
 * Reihenfolge der Bildverarbeitung, wie Mediabunny und FFmpeg sie beide wollen:
 *   Quelle → Drehung aus den Metadaten → eigene Drehung → Beschnitt → Skalierung
 */
import { devicePreset } from "./compatibility";
import { CONTAINERS } from "./formats";
import { planVideoSize, willCopyAudio, willCopyVideo } from "./presets";
import type { Adjustments, CropRect, MediaInfo, Preset } from "./types";

export const NO_ADJUSTMENTS: Adjustments = { rotate: 0 };

/**
 * Gerade Pixelzahl – Encoder wollen das.
 * Rundet ab: Aufrunden ließ einen Beschnitt schon mal über das Bild hinauswachsen.
 */
export const even = (n: number) => Math.floor(n / 2) * 2;

/** Gerade Größe mit einem sinnvollen Mindestmaß. Positionen brauchen das nicht. */
export const evenSize = (n: number) => Math.max(2, even(n));

/** Liegt überhaupt eine Anpassung vor? Sie entscheidet, ob kopiert werden darf. */
export function isAdjusted(a: Adjustments): boolean {
  return a.rotate !== 0 || !!a.crop || !!a.trim?.start || !!a.trim?.end || (a.subtitles?.mode ?? "auto") !== "auto";
}

export function sameAdjustments(a: Adjustments, b: Adjustments): boolean {
  return (
    a.rotate === b.rotate &&
    a.crop?.left === b.crop?.left &&
    a.crop?.top === b.crop?.top &&
    a.crop?.width === b.crop?.width &&
    a.crop?.height === b.crop?.height &&
    (a.trim?.start ?? 0) === (b.trim?.start ?? 0) &&
    (a.trim?.end ?? 0) === (b.trim?.end ?? 0)
  );
}

/** Kürzt den Beschnitt auf das Bild und macht ihn gerade. */
export function clampCrop(crop: CropRect, w: number, h: number): CropRect {
  const width = evenSize(Math.min(crop.width, w));
  const height = evenSize(Math.min(crop.height, h));
  const left = Math.max(0, even(Math.min(crop.left, w - width)));
  const top = Math.max(0, even(Math.min(crop.top, h - height)));
  return { left, top, width, height };
}

export interface Job {
  preset: Preset;
  info: MediaInfo;
  adj: Adjustments;
  /** Anzeigemaße der Quelle – die Drehung aus den Metadaten ist hier schon drin. */
  srcW: number;
  srcH: number;
  /** Maße nach der eigenen Drehung. In diesem Raum liegt der Beschnitt. */
  rotW: number;
  rotH: number;
  /** Wirksam werdender Beschnitt, bereits gekürzt und gerade. */
  crop?: CropRect;
  trim?: { start?: number; end?: number };
  /** Wirksame Länge nach dem Schneiden. */
  duration: number;
  /** Zielgröße nach Beschnitt und Skalierung – fehlt sie, bleibt die Größe. */
  out?: { width: number; height: number; fit?: "fill" | "contain" | "cover" };
  copyVideo: boolean;
  copyAudio: boolean;
}

/** Rechnet aus, was mit einer Datei wirklich passieren soll. */
export function resolveJob(preset: Preset, info: MediaInfo, adj: Adjustments = NO_ADJUSTMENTS): Job {
  preset = devicePreset(preset);
  const hasVideo = !!info.video && CONTAINERS[preset.container].kind === "video" && preset.video.codec !== "none";
  const srcW = info.video?.width ?? 0;
  const srcH = info.video?.height ?? 0;
  const rotate = hasVideo ? adj.rotate : 0;
  const swapped = rotate === 90 || rotate === 270;
  const rotW = swapped ? srcH : srcW;
  const rotH = swapped ? srcW : srcH;

  // Ein Beschnitt, der das ganze Bild abdeckt, ist keiner.
  let crop: CropRect | undefined;
  if (hasVideo && adj.crop && rotW && rotH) {
    const c = clampCrop(adj.crop, rotW, rotH);
    if (c.width < rotW - 2 || c.height < rotH - 2) crop = c;
  }

  const dur = info.duration || 0;
  const start = Math.max(0, Math.min(adj.trim?.start ?? 0, Math.max(0, dur - 0.1)));
  const rawEnd = adj.trim?.end ?? 0;
  const end = rawEnd > 0 ? Math.min(rawEnd, dur) : dur;
  const trim = end - start < dur - 0.05 && end > start ? { start, end } : undefined;
  const duration = trim ? trim.end - trim.start : dur;

  /*
   * Ein Beschnitt über das ganze Bild und ein Schnitt über die ganze Datei sind
   * keine Änderung. Entscheidend ist, was übrig bleibt – sonst würde ein
   * wirkungsloser Rahmen das verlustfreie Kopieren verbieten.
   */
  const effective = adj.rotate !== 0 || !!crop || !!trim;

  const job: Job = {
    preset,
    info,
    adj,
    srcW,
    srcH,
    rotW,
    rotH,
    crop,
    trim,
    duration,
    copyVideo: hasVideo && willCopyVideo(preset, info, effective),
    copyAudio: willCopyAudio(preset, info),
  };

  if (hasVideo && !job.copyVideo) {
    // Nach Drehung und Beschnitt steht die Größe fest, aus der skaliert wird.
    const baseW = crop ? crop.width : rotW;
    const baseH = crop ? crop.height : rotH;
    const planned = planVideoSize(preset.video, baseW, baseH);
    if (planned.resized || baseW % 2 || baseH % 2) job.out = { width: evenSize(planned.width), height: evenSize(planned.height), fit: planned.fit };
  }
  return job;
}

/** Was die Dateiliste über die Anpassungen sagt – kurz, in der Sprache der App. */
export function adjustmentsSummary(adj: Adjustments): string {
  const parts: string[] = [];
  if (adj.rotate) parts.push(`${adj.rotate}° gedreht`);
  if (adj.crop) parts.push("beschnitten");
  if (adj.trim?.start || adj.trim?.end) parts.push("gekürzt");
  /* Erst in der Desktop-App setzbar – aber sichtbar muss es sein, sobald es das ist. */
  const sub = adj.subtitles?.mode;
  if (sub === "burn") parts.push("Untertitel eingebrannt");
  else if (sub === "none") parts.push("Untertitel entfernt");
  else if (sub === "keep") parts.push("Untertitel behalten");
  return parts.join(" · ");
}

/* ───────────── Größenschätzung ───────────── */

const CODEC_FACTOR: Record<string, number> = { h264: 1, h265: 0.62, vp9: 0.7, av1: 0.5, vp8: 1.15 };

export function qualityBitrate(codec: string, quality: number, w: number, h: number, fps: number): number {
  const bpp = 0.024 * Math.pow(5.375, (quality - 20) / 60);
  return bpp * w * h * fps * (CODEC_FACTOR[codec] ?? 1);
}

/**
 * Wie groß wird die Datei ungefähr? Rechnet mit dem, was wirklich passiert –
 * also mit Beschnitt und Schnitt, nicht nur mit dem Preset.
 */
export function estimateOutputBytes(preset: Preset, info: MediaInfo, adj: Adjustments = NO_ADJUSTMENTS): number {
  const job = resolveJob(preset, info, adj);
  const dur = job.duration;
  if (!dur || !isFinite(dur)) return 0;

  let bps = 0;
  if (CONTAINERS[preset.container].kind === "video" && info.video && preset.video.codec !== "none") {
    if (job.copyVideo) {
      bps += info.video.bitrate || (info.size * 8 * 0.9) / (info.duration || dur);
    } else {
      const w = job.out?.width ?? (job.crop?.width || job.rotW);
      const h = job.out?.height ?? (job.crop?.height || job.rotH);
      const fps = Math.min(info.video.fps || 30, preset.video.fps || 999);
      if (preset.video.rateControl === "quality") bps += qualityBitrate(preset.video.codec, preset.video.quality, w, h, fps);
      else bps += preset.video.bitrate * 1000;
    }
  }
  if (info.audio && preset.audio.codec !== "none") {
    const a = preset.audio;
    if (job.copyAudio) bps += info.audio.bitrate || 128000;
    else if (a.codec === "pcm" || a.codec === "flac") {
      const raw = (a.sampleRate || info.audio.sampleRate || 44100) * (a.channels || info.audio.channels || 2) * 16;
      bps += a.codec === "flac" ? raw * 0.55 : raw;
    } else bps += a.bitrate * 1000;
  }
  return (bps * dur) / 8;
}

/**
 * Schnellstart schreibt die Metadaten nach vorn – dafür gibt es zwei Wege.
 * "in-memory" hält die ganze fertige Datei bis zum Abschluss im Arbeitsspeicher;
 * laufen zwei große Dateien gleichzeitig, stirbt der Tab: keine Meldung, keine
 * Datei im Zielordner. "fragmented" schreibt monoton mit konstantem Speicher und
 * hat die Metadaten trotzdem vorn. Die Grenze liegt deshalb weit unter dem, was
 * technisch ginge, und sinkt mit dem verfügbaren Arbeitsspeicher.
 */
export function fastStartMode(expectedBytes: number, deviceMemoryGb = 8): "in-memory" | "fragmented" {
  const cap = deviceMemoryGb <= 4 ? 120_000_000 : 300_000_000;
  return expectedBytes < cap ? "in-memory" : "fragmented";
}

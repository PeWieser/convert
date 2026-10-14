import { devicePreset, isIpod } from "./compatibility";
import { CONTAINERS, MB_AUDIO, MB_VIDEO, VIDEO_CODEC_SHORT, AUDIO_CODEC_LABEL } from "./formats";
import { formatNumber } from "./format";
import type { AudioSettings, MediaInfo, Preset, VideoSettings } from "./types";

export const BASE_VIDEO: VideoSettings = {
  codec: "h264",
  profile: "auto",
  level: "auto",
  rateControl: "quality",
  quality: 75,
  bitrate: 4000,
  maxBitrate: 0,
  maxWidth: 0,
  maxHeight: 0,
  scaling: "fit",
  fps: 0,
  keyframeInterval: 2,
  bframes: 2,
  refs: 3,
  entropy: "cabac",
  twoPass: false,
  deinterlace: false,
  tenBit: false,
  hdrToSdr: false,
  speed: "balanced",
};

export const BASE_AUDIO: AudioSettings = {
  codec: "aac",
  bitrate: 192,
  sampleRate: 0,
  channels: 0,
  normalize: false,
};

/** Werkseinstellung: iPod touch 1. Generation (H.264 Baseline 3.0, 480 × 320, AAC-LC) */
export function ipodPreset(): Preset {
  return {
    id: "preset-ipod",
    name: "iPod touch 1G",
    icon: "smartphone",
    builtin: "ipod",
    compatibility: "ipod-touch-1g",
    container: "mp4",
    video: {
      ...BASE_VIDEO,
      codec: "h264",
      profile: "baseline",
      level: "3.0",
      rateControl: "vbr",
      bitrate: 1200,
      maxBitrate: 1500,
      maxWidth: 480,
      maxHeight: 320,
      scaling: "fit",
      fps: 30,
      keyframeInterval: 2,
      bframes: 0,
      refs: 1,
      entropy: "cavlc",
    },
    audio: { codec: "aac", bitrate: 128, sampleRate: 44100, channels: 2, normalize: false },
    subtitles: "none",
    metadata: "keep",
    fastStart: true,
  };
}

/** Werkseinstellung: alles zu MP4 */
export function mp4Preset(): Preset {
  return {
    id: "preset-mp4",
    name: "Alles zu MP4",
    icon: "film",
    builtin: "mp4",
    container: "mp4",
    video: { ...BASE_VIDEO },
    audio: { ...BASE_AUDIO },
    subtitles: "keep",
    metadata: "keep",
    fastStart: true,
  };
}

export function defaultPresets(): Preset[] {
  return [ipodPreset(), mp4Preset()];
}

export function factoryPreset(kind: "ipod" | "mp4"): Preset {
  return kind === "ipod" ? ipodPreset() : mp4Preset();
}

/** Tiefe Kopie – ein Preset ist reines JSON. */
export function clonePreset(p: Preset): Preset {
  return JSON.parse(JSON.stringify(p)) as Preset;
}

export function cloneAsNew(base: Preset, name?: string): Preset {
  const id = "preset-" + Math.random().toString(36).slice(2, 9);
  const copy: Preset = clonePreset(base);
  delete copy.builtin;
  return { ...copy, id, name: name ?? (base.name.includes("Kopie") ? base.name : `${base.name} Kopie`) };
}

/** Stellt sicher, dass Codecs zum Container passen. */
export function normalizePreset(p: Preset): Preset {
  p = devicePreset(p);
  const c = CONTAINERS[p.container];
  const video = { ...p.video };
  const audio = { ...p.audio };
  if (c.kind === "audio") video.codec = "none";
  else if (video.codec !== "copy" && video.codec !== "none" && !c.video.includes(video.codec)) video.codec = c.video[0];
  if (audio.codec !== "copy" && audio.codec !== "none" && !c.audio.includes(audio.codec as never))
    audio.codec = c.audio[0];
  if (c.kind === "audio" && audio.codec === "none") audio.codec = c.audio[0];
  return { ...p, video, audio };
}

export function withContainer(p: Preset, id: Preset["container"]): Preset {
  const next = CONTAINERS[id];
  let video = p.video;
  if (next.kind === "video" && p.video.codec === "none" && CONTAINERS[p.container].kind === "audio") {
    video = { ...video, codec: "h264" };
  }
  return normalizePreset({ ...p, container: id, video });
}

export function presetSummary(p: Preset): string {
  const c = CONTAINERS[p.container];
  const parts: string[] = [c.label.split(" ")[0]];
  if (c.kind === "video" && p.video.codec !== "none") {
    parts.push(VIDEO_CODEC_SHORT[p.video.codec]);
    if (p.video.maxWidth && p.video.maxHeight) parts.push(`${p.video.maxWidth} × ${p.video.maxHeight}`);
    else if (p.video.maxHeight) parts.push(`${p.video.maxHeight}p`);
    else if (p.video.maxWidth) parts.push(`${p.video.maxWidth} px breit`);
    else parts.push("Originalgröße");
  } else if (p.audio.codec !== "none") {
    const lossless = p.audio.codec === "flac" || p.audio.codec === "pcm";
    parts.push(lossless ? "verlustfrei" : `${p.audio.bitrate} kb/s`);
  }
  return parts.join(" · ");
}

/* ───────────── Geometrie ───────────── */

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export interface PlannedSize {
  width: number;
  height: number;
  fit?: "fill" | "contain" | "cover";
  resized: boolean;
}

/**
 * Berechnet die Zielgröße aus einem bereits gedrehten und beschnittenen Bild,
 * ohne jemals hochzuskalieren.
 */
export function planVideoSize(v: VideoSettings, srcW: number, srcH: number): PlannedSize {
  const w = srcW;
  const h = srcH;
  const mw = v.maxWidth;
  const mh = v.maxHeight;
  if (!mw && !mh) return { width: w, height: h, resized: false };

  const sx = mw ? mw / w : Infinity;
  const sy = mh ? mh / h : Infinity;

  if (v.scaling === "fit" || !(mw && mh)) {
    const s = Math.min(sx, sy, 1);
    if (s >= 1) return { width: w, height: h, resized: false };
    return { width: even(w * s), height: even(h * s), fit: "fill", resized: true };
  }
  if (w <= mw && h <= mh) return { width: w, height: h, resized: false };
  const fit = v.scaling === "pad" ? "contain" : v.scaling === "crop" ? "cover" : "fill";
  return { width: even(mw), height: even(mh), fit, resized: true };
}

/* ───────────── Kopieren statt Neu-Kodieren ───────────── */

/** Smart: Passt die Quelle bereits, wird nicht neu kodiert (schneller, verlustfrei). */
export function willCopyVideo(p: Preset, info: MediaInfo, adjusted: boolean): boolean {
  const v = p.video;
  const src = info.video;
  if (!src || v.codec === "none") return false;
  if (CONTAINERS[p.container].kind === "audio") return false;
  // Gedreht, beschnitten oder gekürzt heißt immer: neu schreiben.
  if (adjusted) return false;
  if (v.codec === "copy") return true;
  if (MB_VIDEO[v.codec] !== src.codec) return false;
  if (v.rateControl !== "quality" || v.quality < 75) return false;
  if (v.profile !== "auto" || v.level !== "auto") return false;
  if (v.deinterlace || v.hdrToSdr || v.tenBit) return false;
  if (p.subtitles === "burn") return false;
  if (planVideoSize(v, src.width, src.height).resized) return false;
  if (v.fps && src.fps > v.fps + 0.5) return false;
  return true;
}

export function willCopyAudio(p: Preset, info: MediaInfo): boolean {
  const a = p.audio;
  const src = info.audio;
  if (isIpod(p)) return false; // AAC alone does not prove AAC-LC; never copy HE-AAC.
  if (!src || a.codec === "none") return false;
  if (a.codec === "copy") return true;
  if (MB_AUDIO[a.codec] !== src.codec) return false;
  if (a.sampleRate && a.sampleRate !== src.sampleRate) return false;
  if (a.channels && a.channels !== src.channels) return false;
  if (a.normalize) return false;
  if (src.bitrate && a.codec !== "flac" && a.codec !== "pcm" && src.bitrate > a.bitrate * 1000 * 1.15) return false;
  return true;
}

/* ───────────── Beschreibungen ───────────── */

export function resolutionLabelFor(v: VideoSettings): string {
  if (!v.maxWidth && !v.maxHeight) return "Original";
  if (v.maxWidth && v.maxHeight) return `${v.maxWidth} × ${v.maxHeight}`;
  if (v.maxHeight) return `${v.maxHeight}p`;
  return `${formatNumber(v.maxWidth)} px`;
}

export function audioDescription(p: Preset): string {
  return AUDIO_CODEC_LABEL[p.audio.codec];
}

import type { AudioCodecId, ContainerId, VideoCodecId } from "./types";

export interface ContainerDef {
  id: ContainerId;
  label: string;
  ext: string;
  kind: "video" | "audio";
  video: VideoCodecId[];
  audio: AudioCodecId[];
}

export const CONTAINERS: Record<ContainerId, ContainerDef> = {
  mp4: { id: "mp4", label: "MP4", ext: "mp4", kind: "video", video: ["h264", "h265", "vp9", "av1", "vp8"], audio: ["aac", "mp3", "opus", "flac", "vorbis", "pcm"] },
  mov: { id: "mov", label: "MOV (QuickTime)", ext: "mov", kind: "video", video: ["h264", "h265", "vp9", "av1", "vp8"], audio: ["aac", "mp3", "opus", "flac", "vorbis", "pcm"] },
  mkv: { id: "mkv", label: "MKV (Matroska)", ext: "mkv", kind: "video", video: ["h264", "h265", "vp9", "av1", "vp8"], audio: ["aac", "mp3", "opus", "flac", "vorbis", "pcm"] },
  webm: { id: "webm", label: "WebM", ext: "webm", kind: "video", video: ["vp9", "av1", "vp8"], audio: ["opus", "vorbis"] },
  ts: { id: "ts", label: "MPEG-TS", ext: "ts", kind: "video", video: ["h264", "h265"], audio: ["aac", "mp3"] },
  mp3: { id: "mp3", label: "MP3", ext: "mp3", kind: "audio", video: [], audio: ["mp3"] },
  aac: { id: "aac", label: "AAC", ext: "aac", kind: "audio", video: [], audio: ["aac"] },
  flac: { id: "flac", label: "FLAC", ext: "flac", kind: "audio", video: [], audio: ["flac"] },
  wav: { id: "wav", label: "WAV", ext: "wav", kind: "audio", video: [], audio: ["pcm"] },
  ogg: { id: "ogg", label: "Ogg", ext: "ogg", kind: "audio", video: [], audio: ["opus", "vorbis"] },
};

export const VIDEO_CONTAINERS: ContainerId[] = ["mp4", "mov", "mkv", "webm", "ts"];
export const AUDIO_CONTAINERS: ContainerId[] = ["mp3", "aac", "flac", "wav", "ogg"];

export const VIDEO_CODEC_LABEL: Record<VideoCodecId, string> = {
  h264: "H.264 (AVC)",
  h265: "H.265 (HEVC)",
  vp9: "VP9",
  av1: "AV1",
  vp8: "VP8",
  copy: "Nicht neu kodieren",
  none: "Kein Video",
};

export const VIDEO_CODEC_SHORT: Record<VideoCodecId, string> = {
  h264: "H.264",
  h265: "H.265",
  vp9: "VP9",
  av1: "AV1",
  vp8: "VP8",
  copy: "Original",
  none: "Kein Video",
};

export const AUDIO_CODEC_LABEL: Record<AudioCodecId, string> = {
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC (verlustfrei)",
  pcm: "PCM (unkomprimiert)",
  copy: "Nicht neu kodieren",
  none: "Kein Ton",
};

/** Zuordnung zu den Codec-Namen der Mediabunny-Engine */
export const MB_VIDEO: Partial<Record<VideoCodecId, string>> = {
  h264: "avc",
  h265: "hevc",
  vp9: "vp9",
  av1: "av1",
  vp8: "vp8",
};
export const MB_AUDIO: Partial<Record<AudioCodecId, string>> = {
  aac: "aac",
  mp3: "mp3",
  opus: "opus",
  vorbis: "vorbis",
  flac: "flac",
  pcm: "pcm-s16",
};

const SOURCE_CODEC_LABEL: Record<string, string> = {
  avc: "H.264",
  hevc: "H.265",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  mpeg2video: "MPEG-2",
  mpeg4: "MPEG-4",
  mjpeg: "MJPEG",
  prores: "ProRes",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC",
  ac3: "AC-3",
  eac3: "E-AC-3",
  dts: "DTS",
  ulaw: "G.711",
  alaw: "G.711",
};

export function sourceCodecLabel(codec: string): string {
  if (!codec) return "";
  if (codec.startsWith("pcm")) return "PCM";
  return SOURCE_CODEC_LABEL[codec] ?? codec.toUpperCase();
}

/**
 * Der Codec einer Quelldatei, übersetzt in die Sprache der Presets.
 *
 * Nötig für die Frage „darf das unverändert in den Zielcontainer?" – die
 * Antwort unterscheidet sich je Container: VP9 gehört in WebM, H.264 nicht
 * in WebM, ProRes in nichts außer MOV. Ohne diese Übersetzung müsste jeder
 * Aufrufer die Namen der Probe-Codecs kennen.
 */
const SOURCE_VIDEO: Record<string, VideoCodecId> = {
  avc: "h264",
  h264: "h264",
  hevc: "h265",
  h265: "h265",
  vp8: "vp8",
  vp9: "vp9",
  av1: "av1",
  av01: "av1",
};

const SOURCE_AUDIO: Record<string, AudioCodecId> = {
  aac: "aac",
  mp3: "mp3",
  opus: "opus",
  vorbis: "vorbis",
  flac: "flac",
  pcm: "pcm",
  "pcm-s16": "pcm",
  "pcm-s16le": "pcm",
  "pcm-s24le": "pcm",
  "pcm-f32le": "pcm",
};

export function sourceVideoCodec(codec: string): VideoCodecId | undefined {
  return SOURCE_VIDEO[codec];
}

export function sourceAudioCodec(codec: string): AudioCodecId | undefined {
  if (!codec) return undefined;
  return SOURCE_AUDIO[codec] ?? (codec.startsWith("pcm") ? "pcm" : undefined);
}

export const MEDIA_EXTENSIONS = new Set([
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "m2ts", "mts", "3gp", "3g2", "ogv", "vob", "asf", "divx", "f4v", "mxf",
  "mp3", "m4a", "m4b", "aac", "wav", "flac", "ogg", "oga", "opus", "wma", "aiff", "aif", "amr", "ac3", "mka", "caf", "weba",
]);

export function isMediaName(name: string): boolean {
  if (name.startsWith(".")) return false;
  const i = name.lastIndexOf(".");
  return i > 0 && MEDIA_EXTENSIONS.has(name.slice(i + 1).toLowerCase());
}

export const LEVELS = ["auto", "1.0", "1.1", "1.2", "1.3", "2.0", "2.1", "2.2", "3.0", "3.1", "3.2", "4.0", "4.1", "4.2", "5.0", "5.1", "5.2"];

export const QUALITY_STOPS: { value: number; label: string }[] = [
  { value: 0, label: "Sehr klein" },
  { value: 25, label: "Klein" },
  { value: 50, label: "Ausgewogen" },
  { value: 75, label: "Hoch" },
  { value: 100, label: "Maximal" },
];

export function qualityLabel(q: number): string {
  let best = QUALITY_STOPS[0];
  for (const s of QUALITY_STOPS) if (Math.abs(s.value - q) <= Math.abs(best.value - q)) best = s;
  return Math.abs(best.value - q) < 1 ? best.label : `${Math.round(q)} %`;
}

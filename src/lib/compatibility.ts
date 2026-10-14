import type { Preset } from "./types";

export const isIpod = (p: Preset) => p.compatibility === "ipod-touch-1g" || p.builtin === "ipod";

/** A named device is a contract, not just a collection of editable suggestions. */
export function devicePreset(p: Preset): Preset {
  if (!isIpod(p)) return p;
  return {
    ...p, compatibility: "ipod-touch-1g", container: "mp4", fastStart: true, subtitles: "none", metadata: "strip",
    video: {
      ...p.video, codec: "h264", profile: "baseline", level: "3.0", tenBit: false,
      rateControl: "vbr", bitrate: 1200, maxBitrate: 1500, maxWidth: 480, maxHeight: 320,
      scaling: "fit", fps: 30, bframes: 0, refs: 1, entropy: "cavlc", twoPass: false,
    },
    audio: { ...p.audio, codec: "aac", bitrate: 128, sampleRate: 44100, channels: 2 },
  };
}

/** Conversion's high-level WebCodecs API cannot enforce these constraints. Fail before writing. */
export function webPresetIssue(p: Preset): string | null {
  if (isIpod(p)) return "iPod touch 1G benötigt die Desktop-App mit FFmpeg. Der Browser kann Baseline 3.0 und die Bitratengrenze nicht zuverlässig erzwingen. Es wurde keine Datei geschrieben.";
  if (p.video.profile !== "auto" || p.video.level !== "auto" || p.video.maxBitrate > 0)
    return "Dieses Preset verlangt ein festes Profil, Level oder eine maximale Bitrate. Bitte die Desktop-App mit FFmpeg verwenden oder diese Grenzen auf Automatisch setzen.";
  if (p.video.deinterlace || p.video.hdrToSdr || p.video.tenBit || p.video.twoPass || p.audio.normalize)
    return "Dieses Preset benötigt FFmpeg (Deinterlacing, HDR/10-Bit, zwei Durchgänge oder Lautheitsnormalisierung). Bitte die Desktop-App verwenden.";
  return null;
}

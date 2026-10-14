import { z } from "zod";
export const id = z.string().uuid();
const positive = (max: number) => z.number().finite().min(0).max(max);
const crop = z.object({ left: positive(100000), top: positive(100000), width: positive(100000).min(2), height: positive(100000).min(2) });
export const settingsSchema = z.object({
  hardware: z.enum(["auto", "off"]), outFolderName: z.string().max(120),
  collision: z.enum(["number", "overwrite", "skip"]), concurrency: positive(8).int(),
  appearance: z.enum(["auto", "light", "dark"]), destination: z.enum(["auto", "custom"]),
  customDestinationName: z.string().max(1024), selectedPresetId: z.string().max(200),
  tmdbKey: z.string().max(200), tmdbLanguage: z.string().max(10),
});
const short = (max: number) => z.string().max(max);
const metadataSchema = z.object({
  title: short(300).optional(), artist: short(300).optional(), year: short(20).optional(),
  genre: short(200).optional(), show: short(300).optional(), season: short(10).optional(),
  episode: short(10).optional(), episodeTitle: short(300).optional(), description: short(4000).optional(),
  poster: z.object({ url: z.string().url().max(2048).startsWith("https://"), mime: short(60) }).optional(),
});
export const conversionSchema = z.object({
  sourceId: id, outputId: id, hardware: z.enum(["auto", "off"]),
  metadata: metadataSchema.optional(),
  adj: z.object({ rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), crop: crop.optional(), trim: z.object({ start: positive(1e9).optional(), end: positive(1e9).optional() }).optional(), subtitles: z.object({ mode: z.enum(["auto", "keep", "none"]), track: positive(1000).int().optional() }).optional() }),
  preset: z.object({
    id: z.string().max(200), name: z.string().max(200), icon: z.enum(["smartphone", "film", "tv", "music", "globe", "clapperboard", "laptop", "sparkles"]),
    builtin: z.enum(["ipod", "mp4"]).optional(), compatibility: z.literal("ipod-touch-1g").optional(),
    container: z.enum(["mp4", "mov", "mkv", "webm", "ts", "mp3", "aac", "flac", "wav", "ogg"]),
    subtitles: z.enum(["keep", "none"]), metadata: z.enum(["keep", "strip"]), fastStart: z.boolean(),
    video: z.object({
      codec: z.enum(["h264", "h265", "vp9", "av1", "vp8", "copy", "none"]), profile: z.enum(["auto", "baseline", "main", "high"]),
      level: z.enum(["auto", "1.0", "1.1", "1.2", "1.3", "2.0", "2.1", "2.2", "3.0", "3.1", "3.2", "4.0", "4.1", "4.2", "5.0", "5.1", "5.2", "6.0", "6.1", "6.2"]),
      rateControl: z.enum(["quality", "vbr", "cbr"]), quality: positive(100), bitrate: positive(1000000).min(1), maxBitrate: positive(1000000),
      maxWidth: positive(16384).int(), maxHeight: positive(16384).int(), scaling: z.enum(["fit", "pad", "crop", "stretch"]), fps: positive(240),
      keyframeInterval: positive(60).min(0.1), bframes: positive(16).int(), refs: positive(16).int(), entropy: z.enum(["cabac", "cavlc"]),
      twoPass: z.boolean(), deinterlace: z.boolean(), tenBit: z.boolean(), hdrToSdr: z.boolean(), speed: z.enum(["fast", "balanced", "slow"]),
    }),
    audio: z.object({ codec: z.enum(["aac", "mp3", "opus", "vorbis", "flac", "pcm", "copy", "none"]), bitrate: positive(10000).min(1), sampleRate: positive(384000).int(), channels: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(6)]), normalize: z.boolean() }),
  }),
});

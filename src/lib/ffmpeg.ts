import { devicePreset, isIpod } from "./compatibility";
import { resolveJob, videoCodecFor, audioCodecFor, coverFitsContainer } from "./job";
import { CONTAINERS } from "./formats";
import { NO_ADJUSTMENTS } from "./job";
import { ffmpegMetadataArgs } from "./metadata";
import type { Adjustments, AudioCodecId, FileMetadata, HardwareInfo, MediaInfo, Preset, VideoCodecId } from "./types";

/**
 * Baut den FFmpeg-Befehl, den die Windows-Version später ausführt.
 * In der Web-Version dient er als transparente Vorschau der gewählten Einstellungen.
 */

type Family = "nvenc" | "amf" | "qsv" | "vt" | "sw";

const ENCODERS: Record<string, Partial<Record<Family, string>>> = {
  h264: { nvenc: "h264_nvenc", amf: "h264_amf", qsv: "h264_qsv", vt: "h264_videotoolbox", sw: "libx264" },
  h265: { nvenc: "hevc_nvenc", amf: "hevc_amf", qsv: "hevc_qsv", vt: "hevc_videotoolbox", sw: "libx265" },
  av1: { nvenc: "av1_nvenc", amf: "av1_amf", qsv: "av1_qsv", sw: "libsvtav1" },
  vp9: { qsv: "vp9_qsv", sw: "libvpx-vp9" },
  vp8: { sw: "libvpx" },
};

const AUDIO_ENC: Record<string, string> = {
  aac: "aac",
  mp3: "libmp3lame",
  opus: "libopus",
  vorbis: "libvorbis",
  flac: "flac",
  pcm: "pcm_s16le",
};

function familyFor(vendor: HardwareInfo["vendor"]): Family {
  switch (vendor) {
    case "nvidia":
      return "nvenc";
    case "amd":
      return "amf";
    case "intel":
      return "qsv";
    case "apple":
      return "vt";
    default:
      return "sw";
  }
}

function crfFor(codec: string, q: number): number {
  switch (codec) {
    case "h265":
      return Math.round(38 - q * 0.2);
    case "av1":
      return Math.round(52 - q * 0.3);
    case "vp9":
      return Math.round(50 - q * 0.3);
    case "vp8":
      return Math.round(40 - q * 0.2);
    default:
      return Math.round(36 - q * 0.2);
  }
}

/**
 * Anführungszeichen nur dort, wo die Shell den Text sonst auseinandernehmen
 * würde. Umlaute brauchen sie nicht, Leerzeichen und `&` schon.
 */
export function shellQuote(s: string): string {
  return /[\s"'`$\\<>(){}[\]*?|&;!#~]/.test(s) ? `"${s.replace(/(["\\$`])/g, "\\$1")}"` : s;
}

/**
 * Im Filtergraph heißt ein Pfad anders als auf der Befehlszeile: `:` trennt dort
 * Filterargumente, `\\` ist das Fluchtzeichen. Ohne diese Übersetzung bricht das
 * Einbrennen von Untertiteln an jedem Windows-Pfad.
 */
function filterPath(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Die Wahrheit des Desktop-Befehls: eine Liste von Aufrufen, jeder ein Array aus
 * Argumenten. Kein Shell-String – `spawn` bekommt genau dieses Array, damit ein
 * Dateiname mit Leerzeichen oder `&` weder ein Fehler noch ein Einbruch ist.
 * Zwei Aufrufe stehen hier nur, wenn das Preset zwei Durchgänge verlangt.
 */
export function buildFfmpegArgs(
  p: Preset,
  hw: HardwareInfo,
  hwEnabled: boolean,
  input = "Quelle.mkv",
  adj: Adjustments = NO_ADJUSTMENTS,
  opts: {
    /** Wohin der erste Durchgang seine verworfenen Bytes schreibt: NUL oder /dev/null. */
    nullDevice?: string;
    info?: MediaInfo;
    passlogfile?: string;
    /** Der echte Zielpfad. Fehlt er, steht der Platzhalter der Vorschau da. */
    output?: string;
    /** Was in der Datei stehen soll – Titel, Serie, Folge, Beschreibung. */
    metadata?: FileMetadata;
    /** Pfad zu einem Titelbild, das mit in die Datei soll. */
    cover?: string;
  } = {}
): string[][] {
  p = devicePreset(p);
  const job = opts.info ? resolveJob(p, opts.info, adj) : undefined;
  if (job) {
    adj = { ...adj, crop: job.crop, trim: job.trim };
    /* Ein Ort für die Entscheidung, welcher Codec wirklich schreibt (`job.ts`). */
    const videoCodec: VideoCodecId = job.copyVideo ? "copy" : videoCodecFor(p, job);
    const audioCodec: AudioCodecId = job.copyAudio ? "copy" : audioCodecFor(p, job);
    p = { ...p, video: { ...p.video, codec: videoCodec }, audio: { ...p.audio, codec: audioCodec } };
  }
  const subMode = adj.subtitles?.mode;
  if (subMode && subMode !== "auto" && !isIpod(p)) p = { ...p, subtitles: subMode };
  const v = p.video;
  const a = p.audio;
  const c = CONTAINERS[p.container];
  const useHw = hwEnabled && hw.available && !isIpod(p);
  const out = opts.output ?? `Ziel.${c.ext}`;
  /* Ein Titelbild bekommt eine eigene Eingabe – nur wo der Container es führt. */
  const cover = opts.cover && coverFitsContainer(p.container) ? opts.cover : undefined;

  const head: string[] = ["ffmpeg", "-hide_banner", "-y"];
  if (useHw) head.push("-hwaccel", "auto");
  /* Schnitt als Eingabe-Option: sucht schnell und bleibt beim Neukodieren genau. */
  if (adj.trim?.start) head.push("-ss", String(adj.trim.start));
  if (adj.trim?.end) head.push("-to", String(adj.trim.end));
  head.push("-i", input);
  if (cover) head.push("-i", cover);
  /*
   * Genau eine Bild- und eine Tonspur, die erste jeder Art. `0:v?` ohne Index
   * mappte früher ALLE Videospuren – mit einer globalen Filterkette davor bricht
   * der Befehl bei Dateien mit zwei Bildspuren (Befund P2-11). Wer explizit
   * mappt, schaltet die Automatik aus; `-vn` wird damit überflüssig.
   */
  if (c.kind === "audio" || v.codec === "none") {
    head.push("-map", "0:a:0?");
  } else {
    head.push("-map", "0:v:0?", "-map", "0:a:0?");
    if (p.subtitles === "keep" && p.container !== "ts") head.push("-map", "0:s?");
  }
  /* Das Titelbild ist immer die zweite Eingabe – als eigenständige Bildspur ohne Ton. */
  if (cover && p.container !== "mkv") head.push("-map", "1:v:0");

  const video: string[] = [];
  let family: Family = "sw";
  let secondPass: string[] | null = null;

  /**
   * Wenn ein Titelbild mitläuft, ist es die zweite Bildspur – und wird nur
   * kopiert. Alle Encoder-Angaben müssen deshalb ausdrücklich die erste
   * Bildspur meinen; sonst bekommt das JPEG Einstellungen wie „CABAC" und
   * FFmpeg bricht ab. Ohne Titelbild bleibt der Befehl so schlank wie vorher.
   */
  const coverStream = !!cover && c.kind === "video";
  const V = (option: string) => (coverStream ? `${option}:v:0` : option);

  if (c.kind === "audio" || v.codec === "none") {
    /* nichts zu tun – es ist gar keine Bildspur gemappt */
  } else if (v.codec === "copy") {
    video.push(V("-c:v"), "copy");
  } else {
    family = useHw && ENCODERS[v.codec]?.[familyFor(hw.vendor)] ? familyFor(hw.vendor) : "sw";
    const enc = ENCODERS[v.codec][family] ?? ENCODERS[v.codec].sw!;
    video.push(V("-c:v"), enc);

    // Filter
    const filters: string[] = [];
    if (v.deinterlace) filters.push(family === "sw" ? "yadif" : "bwdif");
    if (v.hdrToSdr)
      filters.push(
        "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv"
      );
    /* Dieselbe Reihenfolge wie in der Web-Engine: Drehen → Beschneiden → Skalieren. */
    if (adj.rotate === 90) filters.push("transpose=1");
    if (adj.rotate === 180) filters.push("hflip,vflip");
    if (adj.rotate === 270) filters.push("transpose=2");
    if (adj.crop) filters.push(`crop=${adj.crop.width}:${adj.crop.height}:${adj.crop.left}:${adj.crop.top}`);
    const mw = v.maxWidth;
    const mh = v.maxHeight;
    if (job) {
      if (job.out) {
        const { width: w, height: h, fit } = job.out;
        if (fit === "contain") filters.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);
        else if (fit === "cover") filters.push(`scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${w}:${h}`);
        else filters.push(`scale=${w}:${h}`);
      }
    } else if (mw || mh) {
      if (mw && mh) {
        if (v.scaling === "fit")
          filters.push(`scale=w=${mw}:h=${mh}:force_original_aspect_ratio=decrease:force_divisible_by=2`);
        else if (v.scaling === "pad")
          filters.push(
            `scale=w=${mw}:h=${mh}:force_original_aspect_ratio=decrease,pad=${mw}:${mh}:(ow-iw)/2:(oh-ih)/2`
          );
        else if (v.scaling === "crop")
          filters.push(`scale=w=${mw}:h=${mh}:force_original_aspect_ratio=increase,crop=${mw}:${mh}`);
        else filters.push(`scale=${mw}:${mh}`);
      } else if (mh) filters.push(`scale=-2:'min(${mh},ih)'`);
      else filters.push(`scale='min(${mw},iw)':-2`);
    }
    if (isIpod(p) || job?.out) filters.push("setsar=1");
    if (p.subtitles === "burn") filters.push(`subtitles=${filterPath(input)}`);
    if (filters.length) video.push(V("-vf"), filters.join(","));

    // Profil, Level
    if ((v.codec === "h264" || v.codec === "h265") && family !== "vt") {
      if (v.codec === "h264" && v.profile !== "auto") video.push(V("-profile:v"), v.profile);
      if (v.level !== "auto") video.push(V("-level"), v.level);
    }

    // Rate control
    const cq = crfFor(v.codec, v.quality);
    if (v.rateControl === "quality") {
      if (family === "nvenc") video.push("-rc", "vbr", V("-cq"), String(cq), V("-b:v"), "0");
      else if (family === "qsv") video.push(V("-global_quality"), String(cq));
      else if (family === "amf") video.push("-rc", "cqp", V("-qp_i"), String(cq), V("-qp_p"), String(cq));
      else if (family === "vt") video.push(V("-q:v"), String(Math.max(1, Math.round(v.quality))));
      else if (v.codec === "vp9") video.push(V("-crf"), String(cq), V("-b:v"), "0");
      else video.push(V("-crf"), String(cq));
    } else {
      const br = `${v.bitrate}k`;
      if (v.rateControl === "cbr") {
        if (family === "nvenc") video.push("-rc", "cbr");
        video.push(V("-b:v"), br, V("-minrate"), br, V("-maxrate"), br, V("-bufsize"), `${v.bitrate * 2}k`);
      } else {
        if (family === "nvenc") video.push("-rc", "vbr");
        video.push(V("-b:v"), br);
        if (v.maxBitrate) video.push(V("-maxrate"), `${v.maxBitrate}k`, V("-bufsize"), `${v.maxBitrate * 2}k`);
      }
      if (v.twoPass && family === "sw") {
        secondPass = ["-pass", "2"];
      }
    }

    // Geschwindigkeit
    const speedMap: Record<Family, Record<string, string[]>> = {
      sw: { fast: ["-preset", "veryfast"], balanced: ["-preset", "medium"], slow: ["-preset", "slow"] },
      nvenc: { fast: ["-preset", "p2"], balanced: ["-preset", "p4"], slow: ["-preset", "p7"] },
      qsv: { fast: ["-preset", "veryfast"], balanced: ["-preset", "medium"], slow: ["-preset", "veryslow"] },
      amf: { fast: ["-quality", "speed"], balanced: ["-quality", "balanced"], slow: ["-quality", "quality"] },
      vt: { fast: [], balanced: [], slow: [] },
    };
    if (v.codec === "av1" && family === "sw") video.push(V("-preset"), { fast: "10", balanced: "8", slow: "6" }[v.speed]);
    else if (v.codec !== "vp8" && v.codec !== "vp9")
      video.push(...speedMap[family][v.speed].map((value, index) => (index % 2 === 0 ? V(value) : value)));

    // Feinheiten
    if (v.codec === "h264" || v.codec === "h265") {
      if (family !== "vt") video.push(V("-bf"), String(v.bframes));
      if (v.codec === "h264") {
        if (family === "sw" || family === "nvenc" || family === "qsv") video.push(V("-refs"), String(v.refs));
        if (family === "sw" || family === "nvenc") video.push(V("-coder"), v.entropy);
      }
    }
    video.push(V("-pix_fmt"), v.tenBit ? (family === "sw" ? "yuv420p10le" : "p010le") : "yuv420p");
    video.push(V("-force_key_frames"), `expr:gte(t,n_forced*${v.keyframeInterval})`);
    /*
     * Bildrate festnageln. „-fpsmax" gibt es erst ab FFmpeg 7 – ältere, sonst
     * einwandfreie Installationen brachen damit hart ab. „-r" versteht jede
     * Version und liefert konstante 30 Bilder je Sekunde, was iTunes erwartet.
     */
    if (v.fps) video.push(V("-r"), String(v.fps));
  }

  const audio: string[] = [];
  if (a.codec === "none") audio.push("-an");
  else if (a.codec === "copy") audio.push("-c:a", "copy");
  else {
    audio.push("-c:a", AUDIO_ENC[a.codec]);
    if (a.codec !== "flac" && a.codec !== "pcm") audio.push("-b:a", `${a.bitrate}k`);
    if (a.codec === "aac") audio.push("-profile:a", "aac_low");
    if (a.sampleRate) audio.push("-ar", String(a.sampleRate));
    if (a.channels) audio.push("-ac", String(a.channels));
    if (a.normalize) audio.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11");
  }

  const rest: string[] = [];
  if (c.kind === "video") {
    if (p.subtitles === "keep" && p.container !== "ts") {
      rest.push("-c:s", p.container === "mkv" ? "copy" : p.container === "webm" ? "webvtt" : "mov_text");
    } else rest.push("-sn");
  }
  /*
   * Titelbild: In Matroska ist es ein Anhang, in MP4/MOV und bei Tondateien eine
   * Bildspur mit der Kennzeichnung „attached_pic". Nur so zeigen iTunes, VLC und
   * der Explorer es als Cover und nicht als zweites Standbild.
   */
  if (cover) {
    if (p.container === "mkv") rest.push("-attach", cover, "-metadata:s:t:0", "mimetype=image/jpeg");
    else if (c.kind === "audio") rest.push("-c:v", "copy", "-disposition:v:0", "attached_pic");
    else rest.push("-c:v:1", "copy", "-disposition:v:1", "attached_pic");
  }
  if (p.metadata === "strip") rest.push("-map_metadata", "-1", "-map_chapters", "-1");
  /* Was hier steht, wurde ausdrücklich eingetragen – es gilt auch beim Entfernen. */
  rest.push(...ffmpegMetadataArgs(opts.metadata));
  if (p.fastStart && (p.container === "mp4" || p.container === "mov")) rest.push("-movflags", "+faststart");

  if (isIpod(p)) rest.push(V("-tag:v"), "avc1", "-f", "ipod");
  if (opts.passlogfile) video.push("-passlogfile", opts.passlogfile);

  if (secondPass) {
    /* Erster Durchgang: Statistik sammeln und das Bild verwerfen. Zweiter: schreiben. */
    return [
      [...head, ...video, "-pass", "1", "-an", "-sn", "-f", "null", opts.nullDevice ?? "NUL"],
      [...head, ...video, ...secondPass, ...audio, ...rest, out],
    ];
  }
  return [[...head, ...video, ...audio, ...rest, out]];
}

/**
 * Für die Vorschau im Preset-Editor: dieselben Argumente, lesbar verbunden.
 * Die Wahrheit bleibt das Array – die Vorschau ist nur seine Darstellung.
 */
export function buildFfmpegCommand(
  p: Preset,
  hw: HardwareInfo,
  hwEnabled: boolean,
  input = "Quelle.mkv",
  adj: Adjustments = NO_ADJUSTMENTS
): string {
  return buildFfmpegArgs(p, hw, hwEnabled, input, adj)
    .map((call) => call.map(shellQuote).join(" "))
    .join("\n");
}

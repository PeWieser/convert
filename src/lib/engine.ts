/**
 * Engine der Web-Version (WebCodecs via Mediabunny).
 *
 * Die UI spricht ausschließlich mit diesen Funktionen:
 *   initEngine()  → welche Codecs gibt es?
 *   probe()       → Datei analysieren, Defekte erkennen, Vorschaubild
 *   convert()     → konvertieren (GPU zuerst), Defekte automatisch reparieren
 *
 * Die UI kennt diese Datei nicht direkt: `platform.ts` beschreibt die Schnittstelle
 * (`MediaEngine`), `webEngine` am Ende ist ihre Web-Implementierung. Die Windows-App bringt
 * eine eigene mit (FFmpeg, NVENC / AMF / QSV) — `useApp` nimmt die passende.
 */
import {
  ALL_FORMATS,
  AdtsOutputFormat,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  ConversionCanceledError,
  EncodedPacketSink,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  MovOutputFormat,
  MkvOutputFormat,
  MpegTsOutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  StreamTarget,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  getEncodableAudioCodecs,
  getEncodableVideoCodecs,
} from "mediabunny";
import type {
  ConversionAudioOptions,
  ConversionOptions,
  ConversionVideoOptions,
  InputVideoTrack,
  OutputFormat,
} from "mediabunny";
import { OutputWriteError } from "./io";
import { mediabunnyTags } from "./metadata";
import { webPresetIssue } from "./compatibility";
import { extOf, formatDuration } from "./format";
import { AUDIO_CODEC_LABEL, CONTAINERS, MB_AUDIO, MB_VIDEO, VIDEO_CODEC_LABEL, sourceCodecLabel } from "./formats";
import type { OutputSink } from "./platform";
import { detectHardware, withEncoderTruth } from "./hardware";
import { estimateOutputBytes, fastStartMode, resolveJob } from "./job";
import type { Job } from "./job";
import type { MediaEngine } from "./platform";
import type { Adjustments, AudioCodecId, Capabilities, FileMetadata, Health, MediaInfo, Preset, SourceFile, VideoCodecId } from "./types";

/** `navigator.deviceMemory` kennt nur Chromium – fehlt es, rechnet die App vorsichtig. */
function deviceMemoryGb(): number {
  const v = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof v === "number" && v > 0 ? v : 4;
}

export const engineSupported: boolean =
  typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined" && typeof AudioEncoder !== "undefined";

/* ───────────── Fähigkeiten ───────────── */

let capsPromise: Promise<Capabilities> | null = null;

const VIDEO_BACK: Record<string, VideoCodecId> = { avc: "h264", hevc: "h265", vp9: "vp9", av1: "av1", vp8: "vp8" };
const AUDIO_BACK: Record<string, AudioCodecId> = {
  aac: "aac",
  mp3: "mp3",
  opus: "opus",
  vorbis: "vorbis",
  flac: "flac",
  "pcm-s16": "pcm",
};

/**
 * Bausteine, die der Browser nicht selbst kann und die die App nachlädt. Jeder
 * davon ist ein eigener Request – ohne Verbindung fehlt der Encoder. Früher
 * wurde das geschluckt: Die App meldete sich bereit und warf dann jede Datei
 * dieser Formate weg, ohne ein Wort zu sagen.
 */
const LAZY_ENCODERS: { codec: "aac" | "mp3" | "flac"; label: string; register: () => Promise<void> }[] = [
  {
    codec: "aac",
    label: "AAC",
    register: async () => void (await import("@mediabunny/aac-encoder")).registerAacEncoder(),
  },
  {
    codec: "mp3",
    label: "MP3",
    register: async () => void (await import("@mediabunny/mp3-encoder")).registerMp3Encoder(),
  },
  {
    codec: "flac",
    label: "FLAC",
    register: async () => void (await import("@mediabunny/flac-encoder")).registerFlacEncoder(),
  },
];

export function initEngine(): Promise<Capabilities> {
  if (!capsPromise) {
    capsPromise = (async () => {
      if (!engineSupported) return { video: [], audio: [], ready: true, subtitles: false, metadata: false, cover: false };
      const missing: string[] = [];
      for (const e of LAZY_ENCODERS) {
        try {
          if (await canEncodeAudio(e.codec)) continue;
          await e.register();
          if (!(await canEncodeAudio(e.codec))) missing.push(e.label);
        } catch {
          missing.push(e.label);
        }
      }
      const v = (await getEncodableVideoCodecs().catch(() => [])) as string[];
      const a = (await getEncodableAudioCodecs().catch(() => [])) as string[];
      /*
       * Ein unvollständiges Ergebnis wird nicht eingefroren: Sonst fehlen die
       * Bausteine für den Rest der Sitzung, auch wenn die Verbindung längst
       * zurück ist.
       */
      if (missing.length) capsPromise = null;
      return {
        video: v.map((c) => VIDEO_BACK[c]).filter(Boolean),
        audio: a.map((c) => AUDIO_BACK[c]).filter(Boolean),
        ready: true,
        // WebCodecs kann Untertitel weder einbrennen noch entfernen – die Desktop-App kann es.
        subtitles: false,
        // Titel, Serie und Beschreibung schreibt die Engine in die Tags der Ausgabe.
        metadata: true,
        // Ein Titelbild als eigene Spur kann WebCodecs nicht anhängen.
        cover: false,
        missing: missing.length ? missing : undefined,
      };
    })();
  }
  return capsPromise;
}

/* ───────────── Analyse ───────────── */

export interface ProbeResult {
  info?: MediaInfo;
  health: Health;
  thumb?: string;
}

const broken = (reason: string): ProbeResult => ({ health: { state: "broken", reason } });

const UNSUPPORTED_EXT: Record<string, string> = {
  avi: "AVI",
  wmv: "WMV",
  wma: "WMA",
  asf: "ASF",
  flv: "FLV",
  f4v: "FLV",
  mpg: "MPEG",
  mpeg: "MPEG",
  vob: "DVD-Video",
  m2ts: "AVCHD",
  mts: "AVCHD",
  rm: "RealMedia",
  divx: "DivX",
  mxf: "MXF",
  ogv: "Ogg-Video",
  amr: "AMR",
  aiff: "AIFF",
  aif: "AIFF",
  caf: "CAF",
  ac3: "AC-3",
};

function explainUnreadable(name: string): string {
  const ext = extOf(name);
  if (UNSUPPORTED_EXT[ext]) return `${UNSUPPORTED_EXT[ext]}-Dateien kann diese Version nicht lesen.`;
  if (["mp4", "m4v", "mov", "m4a", "3gp", "3g2"].includes(ext))
    return "Der Dateiindex fehlt oder ist beschädigt – typisch für eine unterbrochene Aufnahme oder einen abgebrochenen Download. Ohne eine intakte Vergleichsdatei lässt sich der Inhalt nicht rekonstruieren.";
  if (["mkv", "webm", "mka", "weba"].includes(ext))
    return "Der Dateikopf ist beschädigt, deshalb lässt sich nichts auslesen.";
  if (["mp3", "wav", "flac", "ogg", "oga", "opus", "aac"].includes(ext))
    return "Es wurden keine gültigen Audiodaten gefunden. Die Datei ist beschädigt oder unvollständig.";
  return "Das Format wurde nicht erkannt. Entweder ist die Datei beschädigt, oder sie enthält keine Mediendaten.";
}

async function makeThumb(track: InputVideoTrack, duration: number): Promise<string | undefined> {
  const sink = new CanvasSink(track, { width: 200 });
  const first = await track.getFirstTimestamp();
  const t = first + Math.min(Math.max(duration, 0) * 0.1, 8);
  const wrapped = await sink.getCanvas(t);
  if (!wrapped) return undefined;
  const canvas = wrapped.canvas as HTMLCanvasElement | OffscreenCanvas;
  let blob: Blob | null;
  if ("convertToBlob" in canvas) blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  else blob = await new Promise<Blob | null>((res) => (canvas as HTMLCanvasElement).toBlob(res, "image/jpeg", 0.82));
  return blob ? URL.createObjectURL(blob) : undefined;
}

export async function probe(source: SourceFile): Promise<ProbeResult> {
  const file = source.file;
  if (!file) return broken("Die Quelle ist keine Browser-Datei.");
  if (file.size === 0) return broken("Die Datei ist leer (0 Bytes). Es gibt nichts, was sich retten ließe.");
  if (!engineSupported)
    return broken("Dieser Browser kann Medien nicht verarbeiten. Bitte Chrome oder Edge verwenden.");

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    let formatName = "";
    try {
      formatName = (await input.getFormat()).name;
    } catch {
      return broken(explainUnreadable(file.name));
    }

    let vTrack: InputVideoTrack | null = null;
    let aTrack = null as Awaited<ReturnType<Input["getPrimaryAudioTrack"]>>;
    try {
      vTrack = await input.getPrimaryVideoTrack();
      aTrack = await input.getPrimaryAudioTrack();
    } catch {
      return broken(explainUnreadable(file.name));
    }
    if (!vTrack && !aTrack) return broken("Die Datei enthält weder Bild noch Ton, die sich lesen lassen.");

    const notes: string[] = [];
    let duration = 0;
    try {
      duration = await input.computeDuration();
    } catch {
      notes.push("Die Länge der Datei fehlt – sie wird beim Konvertieren neu berechnet.");
    }
    if (!isFinite(duration) || duration < 0) duration = 0;

    const info: MediaInfo = { format: formatName, duration, size: file.size };

    if (vTrack) {
      const codec = (await vTrack.getCodec()) ?? "";
      const decodable = await vTrack.canDecode().catch(() => false);
      if (!decodable) {
        return broken(
          codec
            ? `Der Videocodec ${sourceCodecLabel(codec)} wird auf diesem Computer nicht unterstützt.`
            : "Der Videocodec dieser Datei ist unbekannt."
        );
      }
      const [width, height, rotation, hdr] = await Promise.all([
        vTrack.getDisplayWidth(),
        vTrack.getDisplayHeight(),
        vTrack.getRotation().catch(() => 0),
        vTrack.hasHighDynamicRange().catch(() => false),
      ]);
      let fps = 0;
      try {
        fps = (await vTrack.computeFrameRateMetrics()).bestGuessFrameRate || 0;
      } catch {
        /* unbekannt */
      }
      let bitrate = 0;
      try {
        bitrate = (await vTrack.getAverageBitrate()) ?? (await vTrack.computePacketStats(120)).averageBitrate ?? 0;
      } catch {
        /* unbekannt */
      }
      info.video = { codec, width, height, fps, bitrate, rotation, hdr };
    }

    if (aTrack) {
      const codec = (await aTrack.getCodec()) ?? "";
      const decodable = await aTrack.canDecode().catch(() => false);
      if (!decodable && !vTrack) {
        return broken(
          codec
            ? `Der Audiocodec ${sourceCodecLabel(codec)} wird auf diesem Computer nicht unterstützt.`
            : "Der Audiocodec dieser Datei ist unbekannt."
        );
      }
      const [channels, sampleRate] = await Promise.all([aTrack.getNumberOfChannels(), aTrack.getSampleRate()]);
      let bitrate = 0;
      try {
        bitrate = (await aTrack.getAverageBitrate()) ?? (await aTrack.computePacketStats(120)).averageBitrate ?? 0;
      } catch {
        /* unbekannt */
      }
      info.audio = { codec, channels, sampleRate, bitrate };
    }

    // Ist das Ende der Datei überhaupt noch vorhanden?
    const probeTrack = vTrack ?? aTrack;
    if (probeTrack && duration > 1) {
      try {
        await new EncodedPacketSink(probeTrack).getPacket(Math.max(0, duration - 0.2));
      } catch {
        notes.push("Die Datei ist unvollständig – das Ende fehlt. Der lesbare Teil wird gerettet.");
      }
    }

    /*
     * Was in der Datei schon steht, wird mitgelesen – sonst wäre der
     * Metadaten-Reiter ein leeres Formular und der Nutzer tippte ab, was
     * ohnehin in der Datei steht.
     */
    let tags: MediaInfo["tags"];
    try {
      const existing = await input.getMetadataTags();
      const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
      const raw = (existing.raw ?? {}) as Record<string, unknown>;
      const rawText = (key: string) => text(raw[key]);
      const read = {
        title: text(existing.title),
        artist: text(existing.artist),
        genre: text(existing.genre),
        show: rawText("tvsh") ?? text(existing.album),
        season: rawText("tvsn"),
        episode: rawText("tves"),
        description: text(existing.description) ?? text(existing.comment),
        year: existing.date ? String(existing.date.getUTCFullYear()) : undefined,
      };
      const clean = Object.fromEntries(Object.entries(read).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length) tags = clean as MediaInfo["tags"];
    } catch {
      /* Metadaten sind eine Zugabe – ohne sie geht das Konvertieren weiter. */
    }

    let thumb: string | undefined;
    if (vTrack) thumb = await makeThumb(vTrack, duration).catch(() => undefined);

    info.tags = tags;
    return {
      info,
      thumb,
      health: notes.length ? { state: "repair", note: notes[0] } : { state: "ok" },
    };
  } catch {
    return broken(explainUnreadable(file.name));
  } finally {
    try {
      input?.dispose();
    } catch {
      /* ignorieren */
    }
  }
}

/* ───────────── Konvertieren ───────────── */

export interface ConvertRequest {
  source: SourceFile;
  info: MediaInfo;
  preset: Preset;
  /** Was mit genau dieser Datei los ist – Drehen, Zuschneiden, Schneiden. */
  adj: Adjustments;
  /** Was in der Ausgabe stehen soll – leer heißt: die Quelle behält ihre Angaben. */
  metadata?: FileMetadata;
  hardware: "auto" | "off";
  openOutput: () => Promise<OutputSink | null>;
  onProgress: (fraction: number, processedSeconds: number) => void;
  signal: AbortSignal;
}

export interface ConvertResult {
  status: "done" | "skipped";
  size: number;
  place: string;
  repaired?: boolean;
  note?: string;
  delivery?: "saved" | "download";
  /**
   * Kennung der fertigen Ausgabe im Register der Plattform.
   *
   * Damit lässt sich eine Datei später zeigen, ohne dass ein Pfad durch die
   * Oberfläche wandert: Der Renderer kennt nur diese Kennung, den Pfad löst
   * allein der Hauptprozess auf. Im Browser bleibt sie leer.
   */
  outputId?: string;
}

export class ConvertError extends Error {
  final: boolean;
  constructor(message: string, final = false) {
    super(message);
    this.final = final;
  }
}

export function isCanceled(e: unknown): boolean {
  return e instanceof ConversionCanceledError || (e instanceof DOMException && e.name === "AbortError");
}

/**
 * Die Web-Implementierung der Naht aus `platform.ts`.
 * Die Desktop-App stellt dieselbe Schnittstelle gegen FFmpeg – die Oberfläche
 * merkt den Unterschied nicht.
 */
export const webEngine: MediaEngine = {
  init: initEngine,
  /*
   * Eine gefundene Grafikkarte heißt noch nicht, dass beschleunigt wird:
   * encodieren muss der Browser. Erst beides zusammen ist eine Auskunft.
   */
  hardware: async () => withEncoderTruth(detectHardware(), (await initEngine()).video.length),
  probe,
  convert,
  isCanceled,
};

type Hw = "prefer-hardware" | "no-preference" | "prefer-software";

function makeFormat(p: Preset, fastStart: false | "in-memory" | "fragmented"): OutputFormat {
  switch (p.container) {
    case "mp4":
      return new Mp4OutputFormat({ fastStart });
    case "mov":
      return new MovOutputFormat({ fastStart });
    case "mkv":
      return new MkvOutputFormat();
    case "webm":
      return new WebMOutputFormat();
    case "ts":
      return new MpegTsOutputFormat();
    case "mp3":
      return new Mp3OutputFormat();
    case "aac":
      return new AdtsOutputFormat();
    case "flac":
      return new FlacOutputFormat();
    case "wav":
      return new WavOutputFormat();
    case "ogg":
      return new OggOutputFormat();
  }
}

function buildVideo(job: Job, hw: Hw, forceTranscode: boolean): ConversionVideoOptions | undefined {
  const p = job.preset;
  const info = job.info;
  const v = p.video;
  if (v.codec === "none" || CONTAINERS[p.container].kind === "audio") return { discard: true };
  if (!info.video) return undefined;
  if (job.copyVideo && !forceTranscode) return {};

  const o: ConversionVideoOptions = { hardwareAcceleration: hw, forceTranscode: true };
  const codec = MB_VIDEO[v.codec];
  if (codec) o.codec = codec as ConversionVideoOptions["codec"];

  /* Reihenfolge der Engine: Drehung → Beschnitt → Skalierung. Genau so steht es im Job. */
  if (job.adj.rotate) o.rotate = job.adj.rotate;
  if (job.crop) o.crop = job.crop;
  if (job.out) {
    o.width = job.out.width;
    o.height = job.out.height;
    o.fit = job.out.fit ?? "fill";
  }
  if (v.fps && info.video.fps > v.fps + 0.5) o.frameRate = v.fps;
  o.keyFrameInterval = Math.max(0.5, v.keyframeInterval);
  o.quality =
    v.rateControl === "quality"
      ? new Quality(Math.min(1, Math.max(0, v.quality / 100)))
      : new Quality({ bitrate: v.bitrate * 1000, bitrateMode: v.rateControl === "cbr" ? "constant" : "variable" });
  return o;
}

function buildAudio(job: Job): ConversionAudioOptions | undefined {
  const p = job.preset;
  const info = job.info;
  const a = p.audio;
  if (a.codec === "none") return { discard: true };
  if (!info.audio) return undefined;
  if (job.copyAudio) return {};

  const o: ConversionAudioOptions = { forceTranscode: true };
  const codec = MB_AUDIO[a.codec];
  if (codec) o.codec = codec as ConversionAudioOptions["codec"];
  if (a.codec !== "pcm" && a.codec !== "flac") o.quality = new Quality({ bitrate: a.bitrate * 1000 });
  if (a.sampleRate) o.sampleRate = a.sampleRate;
  if (a.channels) o.numberOfChannels = a.channels;
  return o;
}

function explainDiscards(conv: Conversion, p: Preset): string {
  for (const d of conv.discardedTracks) {
    const isVideo = d.track.type === "video";
    const label = isVideo ? VIDEO_CODEC_LABEL[p.video.codec] : AUDIO_CODEC_LABEL[p.audio.codec];
    if (d.reason === "no_encodable_target_codec")
      return `Dieser Computer kann ${label} nicht kodieren. Bitte im Preset einen anderen Codec wählen.`;
    if (d.reason === "undecodable_source_codec")
      return `Der ${isVideo ? "Video" : "Audio"}codec der Datei wird auf diesem Computer nicht unterstützt.`;
    if (d.reason === "unknown_source_codec") return "Die Datei verwendet einen unbekannten Codec.";
  }
  return "Aus dieser Datei lässt sich mit den gewählten Einstellungen nichts erzeugen.";
}

function discardNotes(conv: Conversion): string | undefined {
  const lost = conv.discardedTracks.filter(
    (d) =>
      d.track.type !== "subtitle" &&
      (d.reason === "undecodable_source_codec" ||
        d.reason === "unknown_source_codec" ||
        d.reason === "no_encodable_target_codec")
  );
  if (!lost.length) return undefined;
  const hasAudio = lost.some((d) => d.track.type === "audio");
  const hasVideo = lost.some((d) => d.track.type === "video");
  if (hasAudio && !hasVideo) return "Ohne Ton – der Audiocodec wird auf diesem Computer nicht unterstützt.";
  if (hasVideo && !hasAudio) return "Ohne Bild – der Videocodec wird auf diesem Computer nicht unterstützt.";
  return "Einzelne Spuren wurden ausgelassen, weil dieser Computer sie nicht verarbeiten kann.";
}

function explainError(e: unknown, req: ConvertRequest): string {
  if (e instanceof ConvertError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  const low = msg.toLowerCase();
  if (/quota|space|disk full/.test(low)) return "Auf dem Ziellaufwerk ist nicht genug Platz frei.";
  if (/notallowed|nomodification|permission|denied/.test(low)) return "Der Zielordner erlaubt kein Schreiben.";
  if (/encoder|configure|unsupported/.test(low))
    return "Dieser Computer kann die Datei mit diesen Einstellungen nicht kodieren (Profil, Level oder Auflösung wurden abgelehnt).";
  if (/end of file|unexpected end|eof|truncat|out of range/.test(low))
    return "Die Datei ist unvollständig. Der lesbare Teil ist zu kurz, um ihn zu retten.";
  if (/decod/.test(low))
    return "Ein Teil der Datei ist beschädigt und lässt sich nicht dekodieren. Auch die Reparatur konnte nichts retten.";
  const dur = req.info.duration ? ` (Länge ${formatDuration(req.info.duration)})` : "";
  return `Die Konvertierung konnte nicht abgeschlossen werden${dur}: ${msg}`;
}

async function attempt(
  req: ConvertRequest,
  opts: { hw: Hw; trimEnd?: number; noCopy?: boolean },
  state: { processed: number }
): Promise<ConvertResult> {
  const p = req.preset;
  const out = await req.openOutput();
  if (!out) return { status: "skipped", size: 0, place: "" };

  let input: Input | undefined;
  let output: Output | undefined;
  let conversion: Conversion | null = null;
  const onAbort = () => { conversion?.cancel().catch(() => undefined); };
  req.signal.addEventListener("abort", onAbort);

  try {
    if (req.signal.aborted) throw new ConversionCanceledError();
    const job = resolveJob(req.preset, req.info, req.adj);
    input = new Input({ source: new BlobSource(req.source.file!), formats: ALL_FORMATS });
    const useStream = !!out.writable;
    const target = useStream
      ? new StreamTarget(out.writable as never, { chunked: true, chunkSize: 8 * 1024 * 1024 })
      : new BufferTarget();
    const wantsFast = p.fastStart && (p.container === "mp4" || p.container === "mov");
    const expected = estimateOutputBytes(p, req.info, job.adj) || req.source.file!.size;
    // Seekable files do not need to buffer the entire film, nor to become fMP4.
    // Guaranteed faststart without a full RAM buffer is provided by native FFmpeg.
    const fast = wantsFast && !useStream ? fastStartMode(expected, deviceMemoryGb()) : false;
    if (!useStream && expected > 128_000_000) {
      throw new OutputWriteError("Für große Dateien bitte einen Zielordner wählen; ein Browser-Download würde die gesamte Datei im RAM halten.");
    }
    output = new Output({ format: makeFormat(p, fast), target });
    const options: ConversionOptions = { input, output, showWarnings: false };
    const video = buildVideo(job, opts.hw, !!opts.noCopy);
    const audio = buildAudio(job);
    if (video) options.video = video;
    if (audio) options.audio = audio;
    /* Der Reparaturpfad kappt das Ende; der Nutzerschnitt liegt schon im Job. */
    const trimStart = job.trim?.start;
    const trimEnd = opts.trimEnd ?? job.trim?.end;
    if (trimStart || trimEnd !== undefined) {
      options.trim = {};
      if (trimStart && trimEnd !== undefined && trimStart < trimEnd) options.trim.start = trimStart;
      if (trimEnd !== undefined) options.trim.end = trimEnd;
    }
    if (opts.noCopy) options.copy = false;
    /*
     * Metadaten: Erst was schon da ist (oder nichts, wenn das Preset sie
     * entfernt), darüber die ausdrücklich eingetragenen Felder. Eine leere
     * Angabe löscht nichts – sie überschreibt nur, was wirklich dasteht.
     */
    const wanted = mediabunnyTags(req.metadata, p.container === "mkv" || p.container === "webm");
    if (Object.keys(wanted).length) {
      options.tags = (inputTags) => ({ ...(p.metadata === "strip" ? {} : inputTags), ...wanted });
    } else if (p.metadata === "strip") {
      options.tags = {};
    }

    conversion = await Conversion.init(options);
    if (req.signal.aborted) throw new ConversionCanceledError();
    if (!conversion.isValid) throw new ConvertError(explainDiscards(conversion, p), true);

    const note = discardNotes(conversion) ?? (useStream && wantsFast ? "Speicherschonend gespeichert. Schnellstart-Metadaten am Dateianfang sind mit FFmpeg in der Desktop-App verfügbar." : undefined);
    conversion.onProgress = (fraction, processed) => {
      state.processed = processed;
      req.onProgress(Math.min(1, Math.max(0, fraction)), processed);
    };
    await conversion.execute();

    let size: number;
    if (useStream) size = await out.finish();
    else {
      const buffer = (target as BufferTarget).buffer;
      size = await out.finish(buffer ? new Blob([buffer], { type: output.format.mimeType }) : undefined);
    }
    return { status: "done", size, place: out.place, delivery: out.delivery, note: out.delivery === "download" ? "Download angefordert – bitte im Browser prüfen, ob die Datei gespeichert wurde." : note };
  } catch (e) {
    try {
      await output?.cancel();
    } catch {
      /* bereits beendet */
    }
    await out.discard().catch(() => undefined);
    throw e;
  } finally {
    req.signal.removeEventListener("abort", onAbort);
    try {
      input?.dispose();
    } catch {
      /* ignorieren */
    }
  }
}

/**
 * Konvertiert eine Datei.
 * 1. GPU-Encoder zuerst; scheitert er früh, automatisch Software.
 * 2. Bricht die Datei mittendrin, wird der lesbare Teil gerettet.
 * 3. Bricht sie am Anfang, werden Zeitstempel neu aufgebaut.
 * 4. Nur wenn nichts hilft, kommt ein verständlicher Grund zurück.
 */
export async function convert(req: ConvertRequest): Promise<ConvertResult> {
  const issue = webPresetIssue(req.preset);
  if (issue) throw new ConvertError(issue, true);
  if (req.signal.aborted) throw new ConversionCanceledError();
  const plans: Hw[] = req.hardware === "auto" ? ["prefer-hardware", "no-preference"] : ["prefer-software"];
  const dur = req.info.duration;
  let lastError: unknown = null;
  let failedAt = 0;

  for (const hw of plans) {
    const state = { processed: 0 };
    try {
      return await attempt(req, { hw }, state);
    } catch (e) {
      if (isCanceled(e) || req.signal.aborted || e instanceof OutputWriteError) throw e;
      lastError = e;
      failedAt = state.processed;
      if (e instanceof ConvertError && e.final && hw !== "prefer-hardware") throw e;
      // Scheitert es weit hinter dem Anfang, liegt es an der Datei – nicht an der GPU.
      if (failedAt > 3 && dur && failedAt / dur > 0.02) break;
    }
  }

  const softHw: Hw = req.hardware === "auto" ? "no-preference" : "prefer-software";
  // Only evidence of damaged input permits destructive truncation. Never infer
  // corruption from an unknown worker, network, memory or output error.
  if (!(lastError instanceof ConvertError) && /decod|corrupt|truncat|unexpected end|end of file|timestamp/i.test(String(lastError))) {
    if (failedAt > 2) {
      const end = Math.max(1, failedAt - 1.5);
      try {
        const r = await attempt(req, { hw: softHw, trimEnd: end }, { processed: 0 });
        if (r.status === "done") {
          r.repaired = true;
          r.note = `Ab ${formatDuration(failedAt)} war die Datei beschädigt. Gerettet wurde der Teil bis ${formatDuration(end)}${
            dur ? ` von ${formatDuration(dur)}` : ""
          }.`;
        }
        return r;
      } catch (e) {
        if (isCanceled(e) || req.signal.aborted || e instanceof OutputWriteError) throw e;
        lastError = e;
      }
    } else {
      try {
        const r = await attempt(req, { hw: softHw, noCopy: true }, { processed: 0 });
        if (r.status === "done") {
          r.repaired = true;
          r.note = "Die Zeitstempel der Datei waren fehlerhaft und wurden neu aufgebaut.";
        }
        return r;
      } catch (e) {
        if (isCanceled(e) || req.signal.aborted || e instanceof OutputWriteError) throw e;
        lastError = e;
      }
    }
  }
  throw new ConvertError(explainError(lastError, req), true);
}

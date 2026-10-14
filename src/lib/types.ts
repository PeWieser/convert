// Gemeinsame Typen der App. Die UI kennt nur diese Typen – nie die Engine-Details.

export type ContainerId = "mp4" | "mov" | "mkv" | "webm" | "ts" | "mp3" | "aac" | "flac" | "wav" | "ogg";
export type VideoCodecId = "h264" | "h265" | "vp9" | "av1" | "vp8" | "copy" | "none";
export type AudioCodecId = "aac" | "mp3" | "opus" | "vorbis" | "flac" | "pcm" | "copy" | "none";
export type RateControl = "quality" | "vbr" | "cbr";
export type Scaling = "fit" | "pad" | "crop" | "stretch";
export type PresetIcon = "smartphone" | "film" | "tv" | "music" | "globe" | "clapperboard" | "laptop" | "sparkles";

export interface VideoSettings {
  codec: VideoCodecId;
  profile: "auto" | "baseline" | "main" | "high";
  /** "auto" oder z. B. "3.0", "4.1" */
  level: string;
  rateControl: RateControl;
  /** 0–100 (nur bei rateControl = quality) */
  quality: number;
  /** kbit/s (bei vbr / cbr) */
  bitrate: number;
  /** kbit/s, 0 = unbegrenzt */
  maxBitrate: number;
  /** 0 = unbegrenzt */
  maxWidth: number;
  /** 0 = unbegrenzt */
  maxHeight: number;
  scaling: Scaling;
  /** Maximale Bildrate, 0 = Original */
  fps: number;
  /** Sekunden zwischen Keyframes */
  keyframeInterval: number;
  bframes: number;
  refs: number;
  entropy: "cabac" | "cavlc";
  twoPass: boolean;
  deinterlace: boolean;
  tenBit: boolean;
  hdrToSdr: boolean;
  speed: "fast" | "balanced" | "slow";
}

export interface AudioSettings {
  codec: AudioCodecId;
  /** kbit/s */
  bitrate: number;
  /** Hz, 0 = Original */
  sampleRate: number;
  /** 0 = Original */
  channels: 0 | 1 | 2 | 6;
  normalize: boolean;
}

/** Beschnitt in Pixeln – und zwar im Bild *nach* der Drehung, so wie die Engine es macht. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Fakten über eine einzelne Datei.
 *
 * Das Preset sagt, welches Format hinten herauskommen soll. Hier steht, was mit
 * genau *dieser* Datei los ist: sie ist schief, sie hat schwarze Ränder, sie hat
 * zwanzig Sekunden Vorlauf. Deshalb liegt das pro Datei und nicht pro Preset.
 */
export interface Adjustments {
  /** Zusätzlich zu der Drehung, die bereits in den Metadaten der Datei steht. */
  rotate: 0 | 90 | 180 | 270;
  crop?: CropRect;
  /** In Sekunden. Fehlt ein Wert, gilt Anfang bzw. Ende der Datei. */
  trim?: { start?: number; end?: number };
  /**
   * Erst in der Desktop-App wirksam – die Web-Engine kann keine Untertitel.
   * Die Oberfläche zeigt dafür nichts an, solang `Capabilities.subtitles` fehlt.
   */
  subtitles?: { mode: "auto" | "keep" | "burn" | "none"; track?: number };
}

/**
 * Was in der Datei stehen soll – Titel, Serie, Folge, Beschreibung.
 *
 * Das ist der Inhalt, nicht die Verarbeitung: Es gilt pro Datei, wandert aber
 * mit in die Ausgabe. Deshalb steht es nicht im Preset (das beschreibt das
 * Format) und nicht in `Adjustments` (das beschreibt Geometrie).
 */
export interface FileMetadata {
  title?: string;
  /** Regisseur, Studio oder Interpret – je nach Datei das, was naheliegt. */
  artist?: string;
  /** Jahr der Veröffentlichung, z. B. „2007". */
  year?: string;
  genre?: string;
  /** Serienname. Ist er gesetzt, sind Staffel/Episode Zahlen dazu. */
  show?: string;
  /** Staffelnummer. Leer heißt: keine. Als Text, damit „Special" möglich bleibt. */
  season?: string;
  /** Episodennummer. Leer heißt: keine. */
  episode?: string;
  /** Name der Folge – bei einer Serie das, was in der Liste steht. */
  episodeTitle?: string;
  description?: string;
  /**
   * Titelbild. Wird nur eingebettet, wenn die Engine es kann
   * (`Capabilities.cover`) – im Browser bleibt es beim Vermerk.
   */
  poster?: { url: string; mime: string };
}

export interface Preset {
  id: string;
  name: string;
  icon: PresetIcon;
  builtin?: "ipod" | "mp4";
  compatibility?: "ipod-touch-1g";
  container: ContainerId;
  video: VideoSettings;
  audio: AudioSettings;
  /**
   * Nur in der Desktop-App wirksam (FFmpeg). Die Web-Engine kann Untertitel nicht
   * steuern – die Oberfläche fragt `Capabilities.subtitles`, bevor sie das anbietet.
   */
  subtitles: "keep" | "burn" | "none";
  metadata: "keep" | "strip";
  fastStart: boolean;
}

export interface Settings {
  hardware: "auto" | "off";
  outFolderName: string;
  collision: "number" | "overwrite" | "skip";
  /** Gleichzeitig konvertierte Dateien. 0 = automatisch (mit Grafikkarte zwei, sonst eine). */
  concurrency: number;
  appearance: "auto" | "light" | "dark";
  destination: "auto" | "custom";
  customDestinationName: string;
  selectedPresetId: string;
  /** Zugangsschlüssel für The Movie Database (TMDB). Leer = Suche aus. */
  tmdbKey: string;
  /** Sprache der TMDB-Antworten, z. B. „de" oder „en". */
  tmdbLanguage: string;
}

/** Quelle einer Datei inklusive ihrer Herkunft (für das smarte Ziel). */
export interface SourceFile {
  id: string;
  file?: File;
  native?: { size: number; lastModified: number; previewUrl: string };
  name: string;
  handle?: FileSystemFileHandle;
  /** Oberster hinzugefügter Ordner, falls die Datei aus einem Ordner stammt. */
  root?: FileSystemDirectoryHandle;
  /** Unterordner relativ zu `root` */
  relDirs: string[];
}

export interface VideoInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  rotation: number;
  hdr: boolean;
}
export interface AudioInfo {
  codec: string;
  channels: number;
  sampleRate: number;
  bitrate: number;
}
export interface MediaInfo {
  format: string;
  duration: number;
  size: number;
  video?: VideoInfo;
  audio?: AudioInfo;
  /**
   * Was in der Quelldatei schon steht. Damit ist der Metadaten-Reiter ein
   * Bearbeiten und kein leeres Formular – und der Haken kann zeigen, was sich
   * gegenüber der Datei geändert hat.
   */
  tags?: FileMetadata;
}

export type Health =
  | { state: "ok" }
  | { state: "repair"; note: string }
  | { state: "broken"; reason: string };

export type ItemStatus = "checking" | "ready" | "queued" | "converting" | "done" | "failed";

export interface Item {
  id: string;
  source: SourceFile;
  status: ItemStatus;
  info?: MediaInfo;
  health: Health;
  thumb?: string;
  /** 0–1 */
  progress: number;
  /** Wurde in einem Durchlauf bearbeitet */
  attempted?: boolean;
  /** Fehlertext (failed) oder Reparaturhinweis (done) */
  message?: string;
  repaired?: boolean;
  /** Fehler lässt sich nicht durch erneutes Versuchen beheben */
  final?: boolean;
  /** Was mit genau dieser Datei los ist – Drehen, Zuschneiden, Schneiden. */
  adjustments: Adjustments;
  /**
   * Was in der Ausgabe stehen soll – Titel, Serie, Folge, Beschreibung.
   * Fehlt es, übernimmt die Datei ihre eigenen Metadaten wie bisher.
   */
  metadata?: FileMetadata;
  delivery?: "saved" | "download";
  outSize?: number;
  outPlace?: string;
  etaSeconds?: number;
}

export interface HardwareInfo {
  /** Anzeigename der Grafikkarte – leer, wenn die Quelle ihn nicht kennt */
  gpu: string;
  vendor: "nvidia" | "amd" | "intel" | "apple" | "other" | "none";
  /** Name der Encoder-Technik, z. B. NVENC */
  encoder: string;
  available: boolean;
  /**
   * Woher die Erkenntnis stammt. WebGL liefert nur einen Namen, und der Browser
   * darf ihn verdecken. Was zählt, ist die Liste der Encoder: im Web WebCodecs,
   * auf dem Desktop `ffmpeg -encoders`.
   */
  source: "webgl" | "encoders" | "ffmpeg";
  /** Der Browser verdeckt die Grafikkarte. Die App weiß es nicht, statt zu raten. */
  hidden?: boolean;
}

export interface Capabilities {
  video: VideoCodecId[];
  audio: AudioCodecId[];
  ready: boolean;
  /**
   * Nachgeladene Bausteine, die nicht angekommen sind (meist: keine Verbindung).
   * Steht hier etwas, fehlen Formate – und die Oberfläche sagt das, statt still
   * jede Datei wegzuwerfen.
   */
  missing?: string[];
  /**
   * Kann diese Engine Untertitel beibehalten, einbrennen oder entfernen?
   * Web (WebCodecs): nein. Desktop (FFmpeg): ja.
   * Die Oberfläche zeigt keine Regler für Fähigkeiten, die es nicht gibt.
   */
  subtitles: boolean;
  /**
   * Kann die Engine Text-Metadaten (Titel, Serie, Beschreibung) schreiben?
   * Web: ja, über die Tags der Ausgabe. Kommt der Container nicht damit zurecht
   * (MPEG-TS kennt keine Tags), sagt die Engine das beim Schreiben.
   */
  metadata: boolean;
  /**
   * Kann die Engine ein Titelbild in die Datei einbetten?
   * Web (WebCodecs): nein – dort bleibt es bei Titel und Text. Desktop: ja.
   */
  cover: boolean;
}

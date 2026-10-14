/**
 * Die Naht zwischen Oberfläche und Unterbau.
 *
 * Zwei Welten benutzen dieselbe App: der Browser (Mediabunny, File System Access)
 * und später Windows (FFmpeg, `node:fs`). Damit die Oberfläche nie weiß, wo sie
 * läuft, steht hier das gemeinsame Vokabular. Alles in dieser Datei ist
 * **serialisierbar** oder eine reine Funktion — kein Handle, kein Blob, kein
 * lebendiges Objekt. Was über diese Grenze geht, muss durch IPC können.
 *
 * Die lebendigen Gegenstände (Handles, Streams, Prozesse) bleiben hinter den
 * beiden Schnittstellen `PlatformFS` und `MediaEngine` versteckt; im Web stecken
 * sie in `fsa.ts` und `engine.ts`.
 */
import type { ConvertRequest, ConvertResult, ProbeResult } from "./engine";
import type { Capabilities, HardwareInfo, Settings, SourceFile } from "./types";

/* ───────────── Ort statt Gegenstand ───────────── */

/**
 * Ein Ordner, beschrieben statt gehalten.
 *
 * `source`  – der Ordner, aus dem die Datei stammt (liegt bei der Quelle).
 * `known`   – ein gemerkter Quellordner aus dem Gedächtnis des smarten Ziels.
 * `custom`  – der ausdrücklich gewählte Zielordner.
 *
 * Die `id` verweist in ein Register der jeweiligen Plattform; im Web auf einen
 * `FileSystemDirectoryHandle`, auf dem Desktop auf einen Pfad. Deshalb steht hier
 * eine Zeichenkette und kein Handle: Dieses Objekt geht über Prozessgrenzen.
 */
export type FolderRef = { kind: "source" | "known" | "custom"; id: string };

/** Wohin eine fertige Datei soll. Reines JSON, bewusst ohne Lebendiges. */
export type Target = { kind: "download" } | { kind: "folder"; folder: FolderRef; sub: string[] };

/**
 * Eine offene Ausgabe. `writable` heißt: streamend schreiben (echte Datei);
 * fehlt es, sammelt die Engine einen Puffer und übergibt ihn an `finish`.
 */
export interface OutputSink {
  writable?: WritableStream<Uint8Array>;
  /**
   * Wohin die Datei entsteht, wenn die Engine selbst schreibt. Auf dem Desktop
   * bekommt FFmpeg einen Pfad – keinen Strom, den der Renderer füllen müsste.
   */
  path?: string;
  /** Menschliche Ortsangabe für die Dateiliste, z. B. „Videos / Konvertiert". */
  place: string;
  /** Downloads are requested, not verifiably saved by the browser. */
  delivery?: "saved" | "download";
  /** Gibt die geschriebene Größe in Bytes zurück. */
  finish(blob?: Blob): Promise<number>;
  /** Verwirft einen angefangenen Schreibvorgang samt Restdatei. */
  discard(): Promise<void>;
}

/* ───────────── Dateizugriff ───────────── */

export interface PlatformFS {
  /** Kann diese Plattform überhaupt echte Ordner schreiben? */
  readonly supported: boolean;
  pickFiles(): Promise<SourceFile[]>;
  pickFolder(skip: string): Promise<SourceFile[]>;
  /** Muss synchron im Drop-Handler beginnen – der DataTransfer stirbt sofort. */
  collectFromDrop(dt: DataTransfer, skip: string): Promise<SourceFile[]>;
  /** Das smarte Ziel. Wirft `TargetAccessError`, wenn ein Ordner nicht schreiben kann. */
  planTargets(sources: SourceFile[], settings: Settings): Promise<Map<string, Target>>;
  /** `null` heißt: diese Datei überspringen (Kollisionsregel). */
  open(target: Target, source: SourceFile, ext: string, settings: Settings): Promise<OutputSink | null>;
  /** Fragt nach einem Zielordner; `null` heißt abgebrochen. Gibt den Anzeigenamen. */
  chooseCustomDestination(): Promise<string | null>;
  forgetFolders(): Promise<void>;
}

/* ───────────── Engine ───────────── */

export interface MediaEngine {
  init(): Promise<Capabilities>;
  /**
   * Was dieser Rechner wirklich kann. Im Web ein Hinweis aus WebGL, gefiltert
   * durch das, was der Browser encodieren kann; auf dem Desktop die Liste aus
   * `ffmpeg -encoders`. Fehlt die Antwort, bleibt der Hinweis aus dem Start.
   */
  hardware?(): Promise<HardwareInfo>;
  probe(source: SourceFile): Promise<ProbeResult>;
  convert(req: ConvertRequest): Promise<ConvertResult>;
  isCanceled(e: unknown): boolean;
}

/* ───────────── Gemeinsame Logik ───────────── */

/**
 * Der endgültige Dateiname am Ziel.
 *
 * Beide Plattformen stehen vor derselben Frage: Was tun, wenn der Name schon
 * existiert? Die Antwort hängt an der Kollisionsregel und daran, ob die
 * vorhandene Datei die Quelle selbst ist (dann wäre „Ersetzen" Selbstmord).
 * `null` heißt überspringen.
 */
export function chooseName(
  base: string,
  ext: string,
  exists: (name: string) => boolean,
  collision: Settings["collision"],
  sameAsSource: boolean
): string | null {
  const first = `${base}.${ext}`;
  if (!exists(first)) return first;
  if (collision === "skip") return null;
  /* „Ersetzen" auf die eigene Quelle würde die Quelle vernichten – dann nummerieren. */
  const number = collision === "number" || (collision === "overwrite" && sameAsSource);
  if (!number) return first;
  for (let n = 2; n <= 10000; n++) {
    const name = `${base} ${n}.${ext}`;
    if (!exists(name)) return name;
  }
  throw new Error("Kein freier Dateiname gefunden. Bitte einen anderen Zielordner wählen.");
}

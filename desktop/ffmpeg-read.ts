/**
 * Was FFmpeg schreibt, lesen.
 *
 * FFmpeg berichtet nach stderr, eine Zeile pro Schritt:
 *
 *   frame= 1234 fps= 92.0 q=28.0 size=   20480kB time=00:00:41.23 bitrate=4069.1kbits/s speed=3.42x
 *
 * Die App braucht daraus eine Zahl zwischen 0 und 1 für den Balken und das
 * Taskleistensymbol – und im Fehlerfall einen Satz, den ein Mensch versteht,
 * plus die Antwort, ob ein zweiter Versuch überhaupt etwas ändern kann.
 *
 * Diese Datei kennt weder Node noch Electron; sie liest Text. Deshalb gilt sie
 * auf beiden Seiten und ist im Prüfstein testbar.
 */

export interface FfmpegProgress {
  /** Geschriebene Sekunden. */
  seconds: number;
  /** Anteil an der bekannten Gesamtdauer, geklemmt auf 0 bis 1. */
  fraction: number;
  /** `speed=3.42x`: das Wievielfache der Echtzeit. */
  speed?: number;
  /** Geschriebene Bytes, aus `size=`. */
  bytes?: number;
  /** Bilder pro Sekunde, aus `fps=`. */
  fps?: number;
}

const TIME = /(?:^|\s)time=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const SPEED = /(?:^|\s)speed=\s*([0-9.]+)x/;
const SIZE = /(?:^|\s)size=\s*(\d+(?:\.\d+)?)\s*([kmg])i?b/i;
const FPS = /(?:^|\s)fps=\s*([0-9.]+)/;

/**
 * Eine Zeile FFmpeg-Ausgabe. `null`, wenn sie keinen Fortschritt trägt – etwa
 * `time=N/A`, was FFmpeg schreibt, solange es die Dauer nicht kennt.
 */
export function parseProgress(line: string, duration: number): FfmpegProgress | null {
  const t = TIME.exec(line);
  if (!t) return null;
  const seconds = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
  const speed = SPEED.exec(line);
  const size = SIZE.exec(line);
  const fps = FPS.exec(line);
  const unit = size ? size[2].toLowerCase() : "";
  const factor = unit === "g" ? 1024 ** 3 : unit === "m" ? 1024 ** 2 : unit ? 1024 : 1;
  return {
    seconds,
    fraction: duration > 0 ? Math.min(1, Math.max(0, seconds / duration)) : 0,
    speed: speed ? Number(speed[1]) : undefined,
    bytes: size ? Math.round(Number(size[1]) * factor) : undefined,
    fps: fps ? Number(fps[1]) : undefined,
  };
}

export interface FfmpegFailure {
  /** Was passiert ist, in einem Satz. */
  message: string;
  /** Wahr, wenn ein zweiter Versuch dieselbe Antwort bringt. */
  final: boolean;
  /**
   * Was die Engine beim zweiten Versuch anders machen soll. `discard` schreibt
   * mit `-err_detect ignore_err -fflags +discardcorrupt` neu: derselbe Gedanke
   * wie der Reparaturpfad der Web-Engine, nur mit den Mitteln von FFmpeg.
   */
  retry?: "discard";
}

const RULES: { test: RegExp; message: string; final: boolean; retry?: "discard" }[] = [
  {
    test: /no space left on device|not enough space|disk quota exceeded/i,
    message: "Auf dem Ziellaufwerk ist kein Platz mehr.",
    final: true,
  },
  {
    test: /permission denied|access is denied|operation not permitted/i,
    message: "In diesen Ordner darf die App nicht schreiben.",
    final: true,
  },
  {
    test: /unknown encoder|encoder [^ ]+ not found|unrecognized option/i,
    message: "Dieser Encoder fehlt im FFmpeg auf diesem Rechner.",
    final: true,
  },
  {
    test: /moov atom not found|invalid data found when processing input|corrupt/i,
    message: "Die Datei ist beschädigt. Der lesbare Teil wird gerettet.",
    final: false,
    retry: "discard",
  },
  {
    test: /could not find codec parameters|stream \d+ not found|does not contain any stream/i,
    message: "Die Datei verrät ihre Spuren nicht.",
    final: true,
  },
  { test: /no such file or directory/i, message: "Eine der Dateien ist nicht mehr da.", final: true },
  { test: /already exists/i, message: "Die Zieldatei gibt es schon.", final: true },
  { test: /invalid argument/i, message: "FFmpeg lehnt die Argumente ab.", final: true },
];

/**
 * Aus FFmpegs Geschwätz wird ein Satz. Die letzten Zeilen reichen: FFmpeg nennt
 * den Grund am Ende. Findet sich kein bekanntes Muster, steht dort die letzte
 * Zeile im Wortlaut – besser ein echter Satz als eine erfundene Ursache.
 */
export function classifyFailure(stderr: string, canceled = false): FfmpegFailure {
  if (canceled) return { message: "Abgebrochen.", final: false };
  const tail = stderr.slice(-4000);
  for (const rule of RULES) {
    if (rule.test.test(tail)) return { message: rule.message, final: rule.final, retry: rule.retry };
  }
  const last = tail
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  return { message: last ? `FFmpeg: ${last}` : "FFmpeg hat den Lauf beendet, ohne einen Grund zu nennen.", final: true };
}

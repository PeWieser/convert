/**
 * Prüfstein für die reine Logik.
 *
 * `job.ts` ist die einzige Wahrheit darüber, was mit einer Datei passiert — die
 * Web-Engine und der FFmpeg-Befehl lesen beide daraus. Wenn hier etwas falsch
 * rechnet, ist es in beiden Ausgaben falsch. Deshalb steht hier ein Test, auch
 * bevor ein Test-Framework im Projekt ist: gebündelt mit esbuild (liegt ohnehin
 * im Projekt), ausgeführt mit Node.
 *
 *   npm test
 */
import { buildFfmpegCommand } from "../src/lib/ffmpeg";
import { clampCrop, estimateOutputBytes, fastStartMode, isAdjusted, NO_ADJUSTMENTS, resolveJob } from "../src/lib/job";
import { moveTo, slotShift } from "../src/lib/order";
import { defaultPresets } from "../src/lib/presets";
import { hardwareFromEncoders, withEncoderTruth } from "../src/lib/hardware";
import { chooseName } from "../src/lib/platform";
import type { HardwareInfo, MediaInfo, Preset } from "../src/lib/types";

/* ── Kleines Prüfgerüst, damit kein Framework nötig ist ── */

let failures = 0;
let checks = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`✗ ${name}\n    ist:  ${JSON.stringify(got)}\n    soll: ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${name}`);
  }
};
const ok = (name: string, condition: boolean) => eq(name, condition, true);
const group = (name: string) => console.log(`\n${name}`);

/* ── Ausgangslage: eine gewöhnliche 1080p-Datei, zwei Minuten lang ── */

const info: MediaInfo = {
  format: "mp4",
  duration: 120,
  size: 50_000_000,
  /* Breite und Höhe sind die Anzeigemaße – die Drehung aus den Metadaten ist da schon drin. */
  video: { codec: "h264", width: 1920, height: 1080, fps: 30, bitrate: 3_000_000, rotation: 0, hdr: false },
  audio: { codec: "aac", channels: 2, sampleRate: 48000, bitrate: 128_000 },
};
const audioOnly: MediaInfo = { format: "mp3", duration: 200, size: 4_000_000, audio: info.audio };
const preset = defaultPresets()[1] as Preset;
const copyAll = { ...preset, video: { ...preset.video, codec: "copy" as const } };

/* ── Drehung ── */

group("Drehung");
eq("ohne Anpassung bleiben die Maße", [resolveJob(preset, info).rotW, resolveJob(preset, info).rotH], [1920, 1080]);
eq("90° tauscht Breite und Höhe", [resolveJob(preset, info, { rotate: 90 }).rotW, resolveJob(preset, info, { rotate: 90 }).rotH], [1080, 1920]);
eq("270° tauscht Breite und Höhe", [resolveJob(preset, info, { rotate: 270 }).rotW, resolveJob(preset, info, { rotate: 270 }).rotH], [1080, 1920]);
eq("180° lässt die Maße", [resolveJob(preset, info, { rotate: 180 }).rotW, resolveJob(preset, info, { rotate: 180 }).rotH], [1920, 1080]);
eq("eine Tondatei wird nicht gedreht", resolveJob(preset, audioOnly, { rotate: 90 }).rotW, 0);

/* ── Beschnitt ── */

group("Beschnitt");
eq("ungerade Werte werden gerade (abgerundet)", resolveJob(preset, info, { rotate: 0, crop: { left: 3, top: 5, width: 1001, height: 501 } }).crop, {
  left: 2,
  top: 4,
  width: 1000,
  height: 500,
});
eq("zu hoher Beschnitt klemmt an den Rand", resolveJob(preset, info, { rotate: 0, crop: { left: 100, top: 50, width: 1000, height: 2000 } }).crop, {
  left: 100,
  top: 0,
  width: 1000,
  height: 1080,
});
eq("völlig überzogener Beschnitt fällt aufs ganze Bild zurück", resolveJob(preset, info, { rotate: 0, crop: { left: 1800, top: 1000, width: 5000, height: 5000 } }).crop, undefined);
eq("Beschnitt über das ganze Bild ist keiner", resolveJob(preset, info, { rotate: 0, crop: { left: 0, top: 0, width: 1920, height: 1080 } }).crop, undefined);
eq(
  "der Beschnitt liegt im Raum nach der Drehung",
  [resolveJob(preset, info, { rotate: 90, crop: { left: 0, top: 0, width: 1080, height: 960 } }).crop!.width, resolveJob(preset, info, { rotate: 90, crop: { left: 0, top: 0, width: 1080, height: 960 } }).crop!.height],
  [1080, 960]
);
eq("ungerade Quellmaße wachsen nie darüber hinaus", clampCrop({ left: 0, top: 0, width: 1919, height: 1079 }, 1919, 1079), {
  left: 0,
  top: 0,
  width: 1918,
  height: 1078,
});
eq("ein Beschnitt bleibt mindestens zwei Pixel groß", clampCrop({ left: 0, top: 0, width: 1, height: 1 }, 100, 100), { left: 0, top: 0, width: 2, height: 2 });

/* ── Schnitt ── */

group("Schnitt");
eq("die Dauer wird zur Schnittlänge", resolveJob(preset, info, { rotate: 0, trim: { start: 10, end: 60 } }).duration, 50);
eq("Anfang und Ende bleiben erhalten", resolveJob(preset, info, { rotate: 0, trim: { start: 10, end: 60 } }).trim, { start: 10, end: 60 });
eq("Schnitt über die ganze Datei ist keiner", resolveJob(preset, info, { rotate: 0, trim: { start: 0, end: 120 } }).trim, undefined);
eq("das Ende klemmt an die Dauer", resolveJob(preset, info, { rotate: 0, trim: { start: 5, end: 9999 } }).trim, { start: 5, end: 120 });
eq("ohne Ende gilt der Rest der Datei", resolveJob(preset, info, { rotate: 0, trim: { start: 30 } }).duration, 90);
eq("ein umgedrehter Schnitt ergibt nichts", resolveJob(preset, info, { rotate: 0, trim: { start: 60, end: 10 } }).trim, undefined);

/* ── Kopieren oder neu schreiben ── */

group("Verlustfrei kopieren");
eq("nichts geändert → kopieren", resolveJob(copyAll, info, NO_ADJUSTMENTS).copyVideo, true);
eq("drehen → neu schreiben", resolveJob(copyAll, info, { rotate: 90 }).copyVideo, false);
eq("beschneiden → neu schreiben", resolveJob(copyAll, info, { rotate: 0, crop: { left: 0, top: 0, width: 800, height: 600 } }).copyVideo, false);
eq("schneiden → neu schreiben", resolveJob(copyAll, info, { rotate: 0, trim: { start: 1, end: 10 } }).copyVideo, false);
eq("ein wirkungsloser Beschnitt erlaubt weiter kopieren", resolveJob(copyAll, info, { rotate: 0, crop: { left: 0, top: 0, width: 1920, height: 1080 } }).copyVideo, true);
eq("der Ton wird unabhängig vom Bild kopiert", resolveJob(copyAll, info, { rotate: 90 }).copyAudio, true);

/* ── Größenschätzung ── */

group("Größenschätzung");
const full = estimateOutputBytes(preset, info, NO_ADJUSTMENTS);
const half = estimateOutputBytes(preset, info, { rotate: 0, trim: { start: 0, end: 60 } });
const cropped = estimateOutputBytes(preset, info, { rotate: 0, crop: { left: 0, top: 0, width: 960, height: 540 } });
eq("halbe Länge ergibt halbe Größe", Math.round((half / full) * 100), 50);
ok("ein Viertel Bild ergibt deutlich weniger", cropped < full / 3);
ok("die Schätzung bleibt eine positive Zahl", full > 0 && isFinite(full));
eq("ohne Dauer gibt es keine Fantasiezahl", estimateOutputBytes(preset, { ...info, duration: 0 }), 0);

/* ── FFmpeg-Befehl der Desktop-App ── */

group("FFmpeg-Befehl");
const hw: HardwareInfo = { gpu: "keine", vendor: "none", encoder: "", available: false, source: "ffmpeg" };
const cmd = buildFfmpegCommand(preset, hw, false, "Quelle.mkv", {
  rotate: 90,
  crop: { left: 10, top: 20, width: 800, height: 600 },
  trim: { start: 5, end: 42 },
});
console.log(`\n  ${cmd}\n`);
ok("Schnitt-Anfang steht im Befehl", cmd.includes("-ss 5"));
ok("Schnitt-Ende steht im Befehl", cmd.includes("-to 42"));
ok("Drehung wird zu transpose", cmd.includes("transpose=1"));
ok("Beschnitt wird zu crop", cmd.includes("crop=800:600:10:20"));
ok("der Schnitt steht vor der Eingabe (schnelles Suchen)", cmd.indexOf("-ss 5") < cmd.indexOf("-i "));
const order = [cmd.indexOf("transpose=1"), cmd.indexOf("crop="), cmd.indexOf("scale=")].filter((i) => i >= 0);
eq("Reihenfolge: Drehen → Beschneiden → Skalieren", order, [...order].sort((a, b) => a - b));
const plain = buildFfmpegCommand(preset, hw, false);
eq("ohne Anpassungen steht nichts Überflüssiges im Befehl", [plain.includes("crop="), plain.includes("transpose"), plain.includes("-ss")], [false, false, false]);
eq("180° wird zu zwei Spiegelungen", buildFfmpegCommand(preset, hw, false, "q.mkv", { rotate: 180 }).includes("hflip,vflip"), true);
eq("270° dreht andersherum", buildFfmpegCommand(preset, hw, false, "q.mkv", { rotate: 270 }).includes("transpose=2"), true);
/* P2-11: `0:v?` mappte alle Bildspuren und brach mit globaler Filterkette. */
eq("genau eine Bildspur", buildFfmpegCommand(preset, hw, false).includes("-map 0:v:0?"), true);
eq("kein Sammel-Mapping mehr", buildFfmpegCommand(preset, hw, false).includes("-map 0:v? "), false);
eq("genau eine Tonspur", buildFfmpegCommand(preset, hw, false).includes("-map 0:a:0?"), true);
const audioPreset = { ...preset, container: "mp3" as const, video: { ...preset.video, codec: "none" as const } };
eq("reiner Ton mappt kein Bild", buildFfmpegCommand(audioPreset, hw, false).includes("0:v"), false);
const keepSubs = buildFfmpegCommand({ ...preset, subtitles: "keep" }, hw, false);
const burnSubs = buildFfmpegCommand({ ...preset, subtitles: "burn" }, hw, false);
eq("Untertitel behalten: Spuren mappen", keepSubs.includes("-map 0:s?"), true);
eq("Untertitel einbrennen: nicht mappen", burnSubs.includes("-map 0:s?"), false);

/* ── Änderung erkennen ── */

group("Änderung erkennen");
eq("nichts angepasst", isAdjusted(NO_ADJUSTMENTS), false);
eq("gedreht", isAdjusted({ rotate: 90 }), true);
eq("gekürzt", isAdjusted({ rotate: 0, trim: { start: 2 } }), true);
eq("beschnitten", isAdjusted({ rotate: 0, crop: { left: 0, top: 0, width: 10, height: 10 } }), true);
eq("Untertitel ausdrücklich entfernen", isAdjusted({ rotate: 0, subtitles: { mode: "none" } }), true);

/* ── Umsortieren ── */

group("Reihenfolge");
/* Gezählt wird immer die ganze Liste: Stelle 0 ist die gezogene Karte selbst. */
eq("von vorn nach hinten: die mittleren rücken nach links", [0, 1, 2, 3].map((i) => slotShift(i, 0, 2)), [2, -1, -1, 0]);
eq("von hinten nach vorn: die mittleren rücken nach rechts", [0, 1, 2, 3].map((i) => slotShift(i, 3, 1)), [0, 1, 1, -2]);
eq("an Ort und Stelle bewegt sich niemand", [0, 1, 2].map((i) => slotShift(i, 1, 1)), [0, 0, 0]);
eq("ganz nach vorn", [0, 1, 2, 3].map((i) => slotShift(i, 3, 0)), [1, 1, 1, -3]);
eq("ganz nach hinten", [0, 1, 2, 3].map((i) => slotShift(i, 0, 3)), [3, -1, -1, -1]);
eq("moveTo nach hinten", moveTo(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
eq("moveTo nach vorn", moveTo(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
eq("moveTo ganz nach vorn", moveTo(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
eq("moveTo klemmt ans Ende", moveTo(["a", "b", "c"], 0, 99), ["b", "c", "a"]);
eq("moveTo mit fremder Stelle ändert nichts", moveTo(["a", "b"], 7, 0), ["a", "b"]);

/* ── Schnellstart: welcher Weg bei welcher Größe ── */

group("Schnellstart");
/* „in-memory" hält die fertige Datei im Arbeitsspeicher. Zwei große Läufe
   gleichzeitig und der Tab stirbt – ohne Meldung und ohne Datei im Zielordner. */
eq("kleine Datei geht ganz in den Speicher", fastStartMode(50_000_000, 8), "in-memory");
eq("große Datei wird fragmentiert", fastStartMode(500_000_000, 8), "fragmented");
eq("wenig Arbeitsspeicher senkt die Grenze", fastStartMode(200_000_000, 4), "fragmented");
eq("unter der kleinen Grenze bleibt es im Speicher", fastStartMode(100_000_000, 4), "in-memory");
eq("ohne Angabe gilt der vorsichtige Wert", fastStartMode(400_000_000), "fragmented");

/* ── Namensvergabe an der Plattform-Naht ── */

group("Namensregel");
/* Dieselbe Regel gilt im Browser (Download-Ordner, gewählter Ordner) und auf dem
   Desktop (Node `fs`) – nur `exists` kommt aus einer anderen Quelle. */
eq("ohne Konflikt bleibt der Name", chooseName("Urlaub", "mp4", () => false, "skip", false), "Urlaub.mp4");
eq("„Überspringen“ lässt belegte Namen aus", chooseName("Urlaub", "mp4", () => true, "skip", false), null);
eq("„Nummerieren“ zählt hoch, bis ein Name frei ist", chooseName("Urlaub", "mp4", (n) => n !== "Urlaub 3.mp4", "number", false), "Urlaub 3.mp4");
eq("„Ersetzen“ schreibt in dieselbe Datei", chooseName("Urlaub", "mp4", () => true, "overwrite", false), "Urlaub.mp4");
eq("„Ersetzen“ vernichtet nie die Quelle", chooseName("Urlaub", "mp4", (n) => n === "Urlaub.mp4", "overwrite", true), "Urlaub 2.mp4");
eq("die Suche endet auch, wenn alles belegt scheint", chooseName("Urlaub", "mp4", () => true, "number", false), "Urlaub 1000.mp4");

/* ── Hardware: Name ist Hinweis, Encoder-Liste ist Wahrheit ── */

group("Hardware-Wahrheit");
eq(
  "FFmpeg nennt NVENC",
  hardwareFromEncoders(["libx264", "h264_nvenc", "hevc_nvenc"]),
  { gpu: "", vendor: "nvidia", encoder: "NVENC", available: true, source: "ffmpeg" }
);
eq("FFmpeg nennt Quick Sync", hardwareFromEncoders(["h264_qsv"]).encoder, "Quick Sync");
eq("FFmpeg ohne Hardware-Encoder bleibt bei Software", hardwareFromEncoders(["libx264", "libsvtav1"]).available, false);
eq(
  "Web: ohne encodierbares Format gibt es nichts zu beschleunigen",
  withEncoderTruth({ gpu: "RTX 4070", vendor: "nvidia", encoder: "NVENC", available: true, source: "webgl" }, 0).available,
  false
);
eq(
  "Web: mit encodierbarem Format bleibt die Erkenntnis",
  withEncoderTruth({ gpu: "RTX 4070", vendor: "nvidia", encoder: "NVENC", available: true, source: "webgl" }, 3).available,
  true
);
eq("Die FFmpeg-Wahrheit wird nicht wieder infrage gestellt", withEncoderTruth(hardwareFromEncoders(["h264_nvenc"]), 0).available, true);

/* ── Ergebnis ── */

console.log(`\n${checks - failures}/${checks} Prüfungen bestanden`);
if (failures) {
  console.log(`${failures} FEHLER`);
  process.exit(1);
}
console.log("alles grün");

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
import { clampCrop, estimateOutputBytes, isAdjusted, NO_ADJUSTMENTS, resolveJob } from "../src/lib/job";
import { defaultPresets } from "../src/lib/presets";
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
const hw: HardwareInfo = { gpu: "keine", vendor: "none", encoder: "", available: false };
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

/* ── Änderung erkennen ── */

group("Änderung erkennen");
eq("nichts angepasst", isAdjusted(NO_ADJUSTMENTS), false);
eq("gedreht", isAdjusted({ rotate: 90 }), true);
eq("gekürzt", isAdjusted({ rotate: 0, trim: { start: 2 } }), true);
eq("beschnitten", isAdjusted({ rotate: 0, crop: { left: 0, top: 0, width: 10, height: 10 } }), true);
eq("Untertitel ausdrücklich entfernen", isAdjusted({ rotate: 0, subtitles: { mode: "none" } }), true);

/* ── Ergebnis ── */

console.log(`\n${checks - failures}/${checks} Prüfungen bestanden`);
if (failures) {
  console.log(`${failures} FEHLER`);
  process.exit(1);
}
console.log("alles grün");

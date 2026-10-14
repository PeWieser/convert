import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { NativeStore } from "../desktop/fs-node";
import { FfmpegEngine, assertIpod } from "../desktop/engine-ffmpeg";
import { DEFAULT_SETTINGS } from "../src/lib/storage";
import { ipodPreset, mp4Preset } from "../src/lib/presets";
import { buildFfmpegArgs } from "../src/lib/ffmpeg";
import { resolveJob } from "../src/lib/job";
import { run } from "../desktop/process";

const executable = process.env.FFMPEG_PATH || "ffmpeg";
const probe = process.env.FFPROBE_PATH || path.join(path.dirname(executable), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

test("real FFmpeg: high-profile 60fps source -> iPod baseline/LC, ordinary faststart MP4; trim/rotate and cancellation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wandler-media-test-"));
  try {
    const input = path.join(root, "Film & Übung.mp4");
    await run(executable, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=60", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "3", "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-c:a", "aac", input]);
    const store = new NativeStore();
    const [src] = await store.add([input], "Konvertiert");
    let progressEvents = 0;
    const engine = new FfmpegEngine(store, { install: root, userData: root, home: root }, (_id, fraction) => { assert.ok(fraction >= 0 && fraction <= 1); progressEvents++; });
    const settings = { ...DEFAULT_SETTINGS, hardware: "off" as const };
    const plans = new Map(await store.plan([src.id], settings));
    const output = (await store.open(plans.get(src.id)!, src.id, "mp4", settings))!;
    const final = store.getOutput(output.id).final;
    await engine.convert({ sourceId: src.id, outputId: output.id, preset: ipodPreset(), adj: { rotate: 0 }, hardware: "off" });
    assert.ok(await store.finish(output.id) > 1000);
    const json = JSON.parse((await run(probe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", final])).stdout);
    assertIpod(json);
    const bytes = await fs.readFile(final);
    let offset = 0; const atoms: string[] = [];
    while (offset + 8 <= bytes.length) {
      let size = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8));
      atoms.push(type);
      if (!size) break;
      offset += size;
    }
    assert.ok(atoms.includes("moov") && atoms.includes("mdat"));
    assert.ok(atoms.indexOf("moov") < atoms.indexOf("mdat"));
    assert.ok(!atoms.includes("moof"));
    assert.ok(progressEvents > 0);
    assert.equal(json.streams[0].width, 480);
    assert.equal(json.streams[0].height, 270);
    const second = (await store.open(plans.get(src.id)!, src.id, "mp4", settings))!;
    await engine.convert({ sourceId: src.id, outputId: second.id, preset: ipodPreset(), adj: { rotate: 90, trim: { start: 0.5, end: 2 } }, hardware: "off" });
    const secondFinal = store.getOutput(second.id).final;
    await store.finish(second.id);
    const trimmed = JSON.parse((await run(probe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", secondFinal])).stdout);
    assert.ok(Math.abs(Number(trimmed.format.duration) - 1.5) < 0.15);
    assert.ok(trimmed.streams[0].width < trimmed.streams[0].height);
    const canceled = (await store.open(plans.get(src.id)!, src.id, "mp4", settings))!;
    const req = engine.convert({ sourceId: src.id, outputId: canceled.id, preset: mp4Preset(), adj: { rotate: 180 }, hardware: "off" });
    engine.cancel(canceled.id);
    await assert.rejects(req, (e: Error) => e.name === "AbortError");
    await store.discard(canceled.id);
    assert.equal(engine.active.size, 0);
    assert.ok(!(await fs.readdir(path.dirname(final))).some((n) => n.includes("partial")));
    console.log("iPod output:", json.streams.map((s: Record<string, unknown>) => ({ codec: s.codec_name, profile: s.profile, level: s.level, width: s.width, height: s.height, fps: s.avg_frame_rate, sampleRate: s.sample_rate })), "atoms:", atoms);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

/* ───────────── TS nach MP4: kopieren oder rechnen? ───────────── */

/**
 * Der Fall aus dem Alltag: eine Aufnahme im TS-Format soll MP4 werden.
 * Die Prüfung vergleicht nicht Dateigrößen, sondern die Bild- und Tondaten
 * selbst – nur so ist bewiesen, dass nichts neu gerechnet wurde.
 */
/**
 * Die dekodierten Bilder und Töne als Hash – die einzige Aussage, die
 * „unverändert" wirklich belegt. Ein Neu-Encoding hätte andere Hashes.
 */
async function decodedHashes(file: string, map: string): Promise<string> {
  const { stdout } = await run(executable, ["-v", "error", "-i", file, "-map", map, "-f", "framemd5", "-"], { timeout: 30000 });
  return stdout
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(", ").pop()!.trim())
    .join("\n");
}

/** Wie viele Pakete hat die Spur? Ein Remux ändert die Anzahl nicht. */
async function packetCount(file: string, map: string): Promise<number> {
  const { stdout } = await run(executable, ["-v", "error", "-i", file, "-map", map, "-c", "copy", "-f", "framemd5", "-"], { timeout: 30000 });
  return stdout.split("\n").filter((line) => line && !line.startsWith("#")).length;
}

test("real FFmpeg: TS mit H.264/AAC wird nach MP4 umgepackt – Bild und Ton bleiben Byte für Byte gleich", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wandler-remux-test-"));
  try {
    const input = path.join(root, "Aufnahme.ts");
    await run(executable, [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "3", "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k",
      "-f", "mpegts", input,
    ]);

    const store = new NativeStore();
    const [src] = await store.add([input], "Konvertiert");
    const engine = new FfmpegEngine(store, { install: root, userData: root, home: root }, () => undefined);
    const settings = { ...DEFAULT_SETTINGS, hardware: "off" as const };
    const plans = new Map(await store.plan([src.id], settings));
    const output = (await store.open(plans.get(src.id)!, src.id, "mp4", settings))!;
    const final = store.getOutput(output.id).final;

    /*
     * Ton-Bitrate auf 320 kb/s: Die Quelle liegt darüber nicht mehr, also wird
     * wirklich beide Spuren kopiert – das ist der Fall, um den es hier geht.
     */
    const preset = mp4Preset();
    preset.audio = { ...preset.audio, bitrate: 320 };
    await engine.convert({
      sourceId: src.id,
      outputId: output.id,
      preset,
      adj: { rotate: 0 },
      metadata: { title: "Der Test", show: "Meine Serie", season: "2", episode: "7", episodeTitle: "Folge Sieben", year: "2007", description: "Handlung" },
      hardware: "off",
    });
    await store.finish(output.id);

    /* Kein Neukodieren: dieselben Bilder und Töne, dieselbe Anzahl Pakete. */
    assert.equal(await decodedHashes(final, "0:v:0"), await decodedHashes(input, "0:v:0"), "das Bild darf nicht neu gerechnet sein");
    assert.equal(await decodedHashes(final, "0:a:0"), await decodedHashes(input, "0:a:0"), "der Ton darf nicht neu gerechnet sein");
    assert.equal(await packetCount(final, "0:v:0"), await packetCount(input, "0:v:0"));
    assert.equal(await packetCount(final, "0:a:0"), await packetCount(input, "0:a:0"));

    const json = JSON.parse((await run(probe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", final])).stdout);
    assert.equal(json.streams[0].codec_name, "h264");
    assert.equal(json.streams[1].codec_name, "aac");
    /* Ein Metadatenfeld ist erst fertig, wenn es in der Datei steht. */
    assert.equal(json.format.tags.title, "Folge Sieben");
    assert.equal(json.format.tags.show, "Meine Serie");
    assert.equal(json.format.tags.season_number, "2");
    assert.equal(json.format.tags.episode_sort, "7");
    console.log("TS→MP4:", json.format.format_name, json.format.tags);

    /*
     * Und die Gegenprobe mit dem Standard-Preset: Dort liegt die Ton-Bitrate
     * unter der Quelle, deshalb wird nur der Ton gerechnet – das Bild bleibt
     * kopiert. Der Hinweis muss das benennen, sonst passiert es unbemerkt.
     */
    const standard = (await store.open(plans.get(src.id)!, src.id, "mp4", settings))!;
    const standardFinal = store.getOutput(standard.id).final;
    await engine.convert({ sourceId: src.id, outputId: standard.id, preset: mp4Preset(), adj: { rotate: 0 }, hardware: "off" });
    await store.finish(standard.id);
    assert.equal(await decodedHashes(standardFinal, "0:v:0"), await decodedHashes(input, "0:v:0"));
    const plan = resolveJob(mp4Preset(), { ...(await engine.probe(src.id)).info! });
    assert.equal(plan.route.video, "copy");
    assert.equal(plan.route.audio, "encode");
    assert.match(plan.route.note ?? "", /über dem Ziel/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("real FFmpeg: MPEG-2 im TS wird für MP4 wirklich neu gerechnet", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wandler-remux2-test-"));
  try {
    const input = path.join(root, "Alte Aufnahme.ts");
    await run(executable, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-t", "2", "-c:v", "mpeg2video", "-q:v", "4", "-f", "mpegts", input]);
    const store = new NativeStore();
    const [src] = await store.add([input], "Konvertiert");
    const engine = new FfmpegEngine(store, { install: root, userData: root, home: root }, () => undefined);
    const settings = { ...DEFAULT_SETTINGS, hardware: "off" as const };
    const plans = new Map(await store.plan([src.id], settings));
    const output = (await store.open(plans.get(src.id)!, src.id, "mp4", settings))!;
    const final = store.getOutput(output.id).final;
    await engine.convert({ sourceId: src.id, outputId: output.id, preset: mp4Preset(), adj: { rotate: 0 }, hardware: "off" });
    await store.finish(output.id);

    const json = JSON.parse((await run(probe, ["-v", "error", "-show_streams", "-of", "json", final])).stdout);
    assert.equal(json.streams[0].codec_name, "h264");
    /* Und die Bilddaten sind andere als vorher – es wurde gerechnet. */
    assert.notEqual(await decodedHashes(final, "0:v:0"), await decodedHashes(input, "0:v:0"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("real FFmpeg: Titelbild und Metadaten landen in der MP4-Datei", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wandler-cover-test-"));
  try {
    const input = path.join(root, "Film.mp4");
    const cover = path.join(root, "cover.jpg");
    await run(executable, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-t", "1", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", input]);
    await run(executable, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=300x450", "-frames:v", "1", cover]);

    const out = path.join(root, "Mit Cover.mp4");
    await run(executable, [
      "-nostdin", "-hide_banner", "-y",
      ...buildFfmpegArgs(mp4Preset(), { available: false, vendor: "none", encoder: "Software (CPU)", source: "ffmpeg", gpu: "" }, false, input, { rotate: 0 }, {
        output: out,
        metadata: { title: "Mit Bild", description: "Beschreibung", show: "Serie", season: "1", episode: "3", episodeTitle: "Folge Drei" },
        cover,
      })[0].slice(1),
    ]);

    const json = JSON.parse((await run(probe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", out])).stdout);
    const picture = (json.streams as { codec_name?: string; disposition?: Record<string, number> }[]).find(
      (s) => s.disposition?.attached_pic === 1
    );
    assert.ok(picture, "das Titelbild muss als angehängtes Bild in der Datei stehen");
    assert.equal(picture.codec_name, "mjpeg");
    assert.equal(json.format.tags.title, "Folge Drei");
    assert.equal(json.format.tags.show, "Serie");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("real FFmpeg: das Standbild für die Vorschau entsteht neben der Quelle", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wandler-preview-test-"));
  try {
    const video = path.join(root, "Aufnahme.mp4");
    await run(executable, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-t", "2", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", video]);
    const store = new NativeStore();
    const [src] = await store.add([video], "Konvertiert");
    const engine = new FfmpegEngine(store, { install: root, userData: root, home: root }, () => undefined);

    const result = await engine.probe(src.id);
    assert.equal(result.health.state, "ok");
    assert.equal(result.thumb, `wandler-media://preview/${src.id}`, "die Vorschau wird über die Kennung der Quelle angesprochen");

    /* Und dahinter liegt wirklich ein Bild, kein leerer Platzhalter. */
    const file = store.getPreview(src.id);
    const info = JSON.parse((await run(probe, ["-v", "error", "-show_streams", "-of", "json", file])).stdout);
    assert.equal(info.streams[0].codec_type, "video");
    assert.ok(Number(info.streams[0].width) > 0 && Number(info.streams[0].height) > 0);

    /* Eine Tondatei hat kein Bild – und bekommt deshalb keins erfunden. */
    const audio = path.join(root, "Ton.mp3");
    await run(executable, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1", "-c:a", "libmp3lame", audio]);
    const [tone] = await store.add([audio], "Konvertiert");
    const toneResult = await engine.probe(tone.id);
    assert.equal(toneResult.health.state, "ok");
    assert.equal(toneResult.thumb, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

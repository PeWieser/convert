import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { transactionalStream, OutputWriteError } from "../src/lib/io";
import { NativeStore } from "../desktop/fs-node";
import { chooseName } from "../src/lib/platform";
import { DEFAULT_SETTINGS } from "../src/lib/storage";
import { cloneAsNew, ipodPreset, mp4Preset, willCopyAudio } from "../src/lib/presets";
import { devicePreset, webPresetIssue } from "../src/lib/compatibility";
import { buildFfmpegArgs } from "../src/lib/ffmpeg";
import { assertIpod } from "../desktop/engine-ffmpeg";
import { createLimiter } from "../src/lib/queue";
import { conversionSchema } from "../desktop/validation";
import { RevealRegistry } from "../desktop/reveal-registry";

const hw = { available: true, vendor: "nvidia", encoder: "NVENC", source: "ffmpeg", gpu: "" } as const;

test("iPod contract survives clones and forbids HE-AAC copy / hardware encode", () => {
  const p = cloneAsNew(ipodPreset());
  p.video.profile = "high";
  p.video.tenBit = true;
  assert.equal(devicePreset(p).video.profile, "baseline");
  assert.equal(devicePreset(p).video.tenBit, false);
  assert.ok(webPresetIssue(p)?.includes("Desktop"));
  assert.equal(webPresetIssue(mp4Preset()), null);
  assert.equal(willCopyAudio(p, { format: "mp4", duration: 1, size: 1, audio: { codec: "aac", bitrate: 64000, sampleRate: 44100, channels: 2 } }), false);
  const args = buildFfmpegArgs(p, hw, true)[0];
  for (const value of ["libx264", "baseline", "3.0", "yuv420p", "aac_low", "1500k", "+faststart", "ipod"]) assert.ok(args.includes(value), value);
  assert.ok(!args.includes("h264_nvenc"));
  assert.ok(!args.some((a) => a.includes("frag")));
  assert.throws(() => assertIpod({ streams: [{ codec_type: "video", codec_name: "h264", profile: "High", level: 30 }] }));
});

test("name exhaustion fails closed, never chooses an occupied last name", () => {
  assert.throws(() => chooseName("Film", "mp4", () => true, "number", false), /Kein freier/);
});

test("browser transaction commits only after explicit finish", async () => {
  let old = "previous", draft = "";
  const native = new WritableStream({ write(chunk) { draft += chunk; }, close() { old = draft; }, abort() { draft = ""; } });
  const tx = transactionalStream(native as FileSystemWritableFileStream);
  const writer = tx.writable.getWriter();
  await writer.write("converted");
  await writer.close();
  assert.equal(old, "previous");
  await tx.commit();
  assert.equal(old, "converted");
});

test("aborting failed overwrite preserves previous output; storage failures are typed", async () => {
  let old = "previous";
  const native = new WritableStream({ write() { throw new Error("network lost"); }, close() { old = "bad"; } });
  const tx = transactionalStream(native as FileSystemWritableFileStream);
  await assert.rejects(tx.writable.getWriter().write("bytes"), OutputWriteError);
  await tx.abort();
  assert.equal(old, "previous");
});

test("native parallel duplicate names, rollback, source protection and atomic commit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wandler-test-"));
  try {
    await fs.mkdir(path.join(root, "a")); await fs.mkdir(path.join(root, "b")); await fs.mkdir(path.join(root, "out"));
    await fs.writeFile(path.join(root, "a", "Film.mp4"), "SOURCE A");
    await fs.writeFile(path.join(root, "b", "Film.mp4"), "SOURCE B");
    const store = new NativeStore();
    const sources = await store.add([path.join(root, "a", "Film.mp4"), path.join(root, "b", "Film.mp4")], "Konvertiert");
    store.custom = path.join(root, "out");
    const settings = { ...DEFAULT_SETTINGS, destination: "custom" as const };
    const plans = new Map(await store.plan(sources.map((s) => s.id), settings));
    const outputs = await Promise.all(sources.map((s) => store.open(plans.get(s.id)!, s.id, "mp4", settings)));
    assert.notEqual(store.getOutput(outputs[0]!.id).final, store.getOutput(outputs[1]!.id).final);
    for (const out of outputs) {
      await fs.writeFile(store.getOutput(out!.id).temp, "VALID");
      await assert.rejects(store.finish(out!.id), /geprüft/);
      store.getOutput(out!.id).validated = true;
      assert.equal(await store.finish(out!.id), 5);
    }
    assert.equal(await fs.readFile(path.join(root, "out", "Film.mp4"), "utf8"), "VALID");
    const overwrite = { ...settings, collision: "overwrite" as const };
    const out = await store.open(plans.get(sources[0].id)!, sources[0].id, "mp4", overwrite);
    await fs.writeFile(store.getOutput(out!.id).temp, "FAILED");
    await store.discard(out!.id);
    assert.equal(await fs.readFile(path.join(root, "out", "Film.mp4"), "utf8"), "VALID");
    store.custom = path.join(root, "a");
    const own = new Map(await store.plan([sources[0].id], overwrite));
    const protectedOut = await store.open(own.get(sources[0].id)!, sources[0].id, "mp4", overwrite);
    assert.equal(path.basename(store.getOutput(protectedOut!.id).final), "Film 2.mp4");
    await store.discard(protectedOut!.id);
    assert.equal(await fs.readFile(path.join(root, "a", "Film.mp4"), "utf8"), "SOURCE A");
    await assert.rejects(store.open({ kind: "download" }, sources[0].id, "mp4", settings), /vorbereitet/);
    assert.equal((await fs.readdir(path.join(root, "out"))).filter((n) => n.includes("partial")).length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("renderer cannot inject filter graphs or arbitrary codecs into FFmpeg", () => {
  const req = { sourceId: "49d38df8-82e8-482c-baf3-cd3497f9e185", outputId: "83da69bc-5dfb-462c-bce8-0c588f6072bb", preset: mp4Preset(), adj: { rotate: 0 }, hardware: "off" };
  assert.ok(conversionSchema.safeParse(req).success);
  assert.equal(conversionSchema.safeParse({ ...req, preset: { ...req.preset, video: { ...req.preset.video, maxWidth: "1;movie=secret" } } }).success, false);
});

test("queue continues after a synchronous task error", async () => {
  const limit = createLimiter(1);
  await assert.rejects(limit(() => { throw new Error("boom"); }), /boom/);
  assert.equal(await limit(async () => 42), 42);
});

test("same metadata from different folders is not discarded as a duplicate", async () => {
  const { uniqueSources } = await import("../src/lib/sources");
  const file = new File(["same bytes"], "IMG0001.mp4", { lastModified: 1 });
  const first = { id: "a", name: file.name, file, relDirs: [] };
  const second = { ...first, id: "b", file: new File(["same bytes"], file.name, { lastModified: 1 }) };
  assert.deepEqual(await uniqueSources([first], [second, first]), [second]);
});

test("native copy preset with edits transcodes instead of silently ignoring the edits", () => {
  const preset = { ...mp4Preset(), video: { ...mp4Preset().video, codec: "copy" as const } };
  const args = buildFfmpegArgs(preset, hw, false, "input.mp4", { rotate: 90 }, {
    info: { duration: 2, size: 100, format: "mp4", video: { codec: "avc", width: 641, height: 481, fps: 30, bitrate: 1000, hdr: false, rotation: 0 } },
  })[0];
  assert.equal(args[args.indexOf("-c:v") + 1], "libx264");
  assert.ok(args.some((s) => s.includes("transpose=1") && s.includes("scale=480:640")));
});

test("fertige Dateien bleiben auffindbar – aber der Speicher wächst nicht mit", () => {
  const registry = new RevealRegistry(3);
  /* Unbekannte Kennung: nichts zeigen, statt irgendetwas zu zeigen. */
  assert.equal(registry.find("fremd"), undefined);

  registry.remember("a", "/Ziel/A.mp4");
  registry.remember("b", "/Ziel/B.mp4");
  assert.equal(registry.find("a"), "/Ziel/A.mp4");
  assert.equal(registry.find("b"), "/Ziel/B.mp4");

  /* Dieselbe Kennung erneut – der neue Pfad gilt, die Kennung bleibt vorn. */
  registry.remember("a", "/Anders/A.mp4");
  assert.equal(registry.find("a"), "/Anders/A.mp4");
  assert.equal(registry.size, 2);

  /* Die Grenze greift und verdrängt die älteste, nicht die zuletzt gefragte. */
  registry.remember("c", "/Ziel/C.mp4");
  registry.remember("d", "/Ziel/D.mp4");
  assert.equal(registry.size, 3);
  assert.equal(registry.find("b"), undefined);
  assert.equal(registry.find("a"), "/Anders/A.mp4");
  assert.equal(registry.find("d"), "/Ziel/D.mp4");
});

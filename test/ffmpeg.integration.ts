import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { NativeStore } from "../desktop/fs-node";
import { FfmpegEngine, assertIpod } from "../desktop/engine-ffmpeg";
import { DEFAULT_SETTINGS } from "../src/lib/storage";
import { ipodPreset, mp4Preset } from "../src/lib/presets";
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

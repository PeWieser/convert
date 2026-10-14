/**
 * Prüfstein für die Frage „kopieren oder neu kodieren?".
 *
 * Die Antwort steht in `job.ts` und gilt für beide Engines. Hier wird sie an
 * den Fällen geprüft, die im Alltag vorkommen – vor allem am TS-aus-der-Kamera
 * nach MP4, denn genau dort war das Verhalten vorher nicht nachvollziehbar.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mp4Preset, ipodPreset, BASE_VIDEO } from "../src/lib/presets";
import {
  audioCodecFor,
  resolveJob,
  routeIsLossless,
  routeLabel,
  videoCodecFor,
  containerAcceptsAudio,
  containerAcceptsVideo,
} from "../src/lib/job";
import { buildFfmpegArgs } from "../src/lib/ffmpeg";
import { ffmpegMetadataArgs, guessFromName, isMetadataEmpty, mediabunnyTags, metadataSummary, metadataSupport } from "../src/lib/metadata";
import type { HardwareInfo, MediaInfo, Preset } from "../src/lib/types";

const hw: HardwareInfo = { available: false, vendor: "none", encoder: "Software (CPU)", source: "ffmpeg", gpu: "" };

/** Eine Aufnahme, wie sie aus dem Fernseher oder von einer Kamera kommt. */
const tsH264: MediaInfo = {
  format: "mpegts",
  duration: 60,
  size: 30_000_000,
  video: { codec: "avc", width: 1920, height: 1080, fps: 25, bitrate: 3_500_000, rotation: 0, hdr: false },
  audio: { codec: "aac", channels: 2, sampleRate: 48000, bitrate: 128_000 },
};

const tsMpeg2: MediaInfo = {
  ...tsH264,
  video: { ...tsH264.video!, codec: "mpeg2video" },
  audio: { codec: "ac3", channels: 2, sampleRate: 48000, bitrate: 384_000 },
};

test("TS mit H.264 und AAC nach MP4: nur der Container wechselt", () => {
  const job = resolveJob(mp4Preset(), tsH264);
  assert.equal(job.copyVideo, true);
  assert.equal(job.copyAudio, true);
  assert.deepEqual(job.route, { video: "copy", audio: "copy", note: undefined });
  assert.equal(routeLabel(job.route), "Ohne Qualitätsverlust");
  assert.equal(routeIsLossless(job.route), true);

  const args = buildFfmpegArgs(mp4Preset(), hw, false, "Kamera.ts", undefined, { info: tsH264 })[0];
  assert.ok(args.includes("copy"));
  assert.ok(!args.includes("libx264"), "bei einem Remux darf kein Encoder im Befehl stehen");
  assert.ok(!args.includes("-vf"), "und keine Filterkette – das Bild bleibt, wie es ist");
});

test("TS mit H.264 und AC-3 nach MP4: Bild bleibt, Ton wird gerechnet", () => {
  const info: MediaInfo = { ...tsH264, audio: { codec: "ac3", channels: 2, sampleRate: 48000, bitrate: 384_000 } };
  const job = resolveJob(mp4Preset(), info);
  assert.deepEqual(job.route, { video: "copy", audio: "encode", note: undefined });
  assert.equal(routeLabel(job.route), "Nur der Ton wird gerechnet");
  assert.equal(routeIsLossless(job.route), false);

  const args = buildFfmpegArgs(mp4Preset(), hw, false, "Kamera.ts", undefined, { info })[0];
  assert.ok(args.includes("libx264") === false);
  /* Ein Ort für die Entscheidung: Der Encoder für den Ton steht im Befehl. */
  assert.equal(audioCodecFor(mp4Preset(), job), "aac");
});

test("TS mit MPEG-2 nach MP4: das Bild wird wirklich neu gerechnet", () => {
  const job = resolveJob(mp4Preset(), tsMpeg2);
  assert.deepEqual(job.route, { video: "encode", audio: "encode", note: undefined });
  assert.equal(routeLabel(job.route), "Wird neu gerechnet");
  const args = buildFfmpegArgs(mp4Preset(), hw, false, "Kamera.ts", undefined, { info: tsMpeg2 })[0];
  assert.ok(args.includes("libx264"));
  assert.equal(videoCodecFor(mp4Preset(), job), "h264");
});

test("Auch Nicht-Neukodieren prueft den Zielcontainer statt ins Leere zu kopieren", () => {
  const copyToMp4: Preset = { ...mp4Preset(), video: { ...BASE_VIDEO, codec: "copy" }, audio: { ...mp4Preset().audio, codec: "copy" } };
  /* H.264 und AAC passen in MP4 – hier bleibt es beim Kopieren. */
  assert.equal(containerAcceptsVideo(copyToMp4, tsH264), true);
  assert.equal(containerAcceptsAudio(copyToMp4, tsH264), true);
  const ok = resolveJob(copyToMp4, tsH264);
  assert.deepEqual(ok.route, { video: "copy", audio: "copy", note: undefined });

  /* MPEG-2 passt nicht in MP4 – daraus wird ein echter Codec statt einer Fehlermeldung. */
  const mpeg2: MediaInfo = { ...tsH264, video: { ...tsH264.video!, codec: "mpeg2video" } };
  assert.equal(containerAcceptsVideo(copyToMp4, mpeg2), false);
  const fixed = resolveJob(copyToMp4, mpeg2);
  assert.equal(fixed.copyVideo, false);
  assert.equal(fixed.route.video, "encode");
  assert.match(fixed.route.note ?? "", /MPEG-2 passt nicht in MP4/);
  assert.equal(videoCodecFor(copyToMp4, fixed), "h264");
  const args = buildFfmpegArgs(copyToMp4, hw, false, "Kamera.ts", undefined, { info: mpeg2 })[0];
  assert.ok(args.includes("libx264"), "der Ersatzcodec muss im Befehl stehen");
  /* Der Ton darf kopiert werden – das Bild aber nicht. */
  const i = args.indexOf("-c:v");
  assert.notEqual(i, -1);
  assert.notEqual(args[i + 1], "copy", "das Bild darf nicht kopiert werden");
});

test("DTS nach WebM wird als Ton neu geschrieben", () => {
  const webm: Preset = { ...mp4Preset(), container: "webm", video: { ...BASE_VIDEO, codec: "vp9" }, audio: { ...mp4Preset().audio, codec: "copy" } };
  const info: MediaInfo = { ...tsH264, audio: { codec: "dts", channels: 6, sampleRate: 48000, bitrate: 768_000 } };
  const job = resolveJob(webm, info);
  assert.equal(job.copyAudio, false);
  assert.equal(job.route.audio, "encode");
  assert.match(job.route.note ?? "", /DTS passt nicht in WebM/);
  assert.equal(audioCodecFor(webm, job), "opus");
});

test("Schnitt und Drehung heben das Kopieren auf – mit Begründung", () => {
  const copy: Preset = { ...mp4Preset(), video: { ...BASE_VIDEO, codec: "copy" } };
  const job = resolveJob(copy, tsH264, { rotate: 90 });
  assert.equal(job.copyVideo, false);
  assert.match(job.route.note ?? "", /Drehen, Zuschneiden oder Schneiden/);
});

test("Das iPod-Preset kopiert nie – auch nicht bei passender Quelle", () => {
  const job = resolveJob(ipodPreset(), { ...tsH264, video: { ...tsH264.video!, width: 320, height: 240, fps: 30 } });
  assert.equal(job.copyVideo, false);
  assert.equal(job.copyAudio, false);
  assert.equal(job.route.video, "encode");
});

test("Metadaten: nur Ausgefülltes wird geschrieben", () => {
  assert.deepEqual(ffmpegMetadataArgs({}), []);
  assert.deepEqual(ffmpegMetadataArgs({ title: "   " }), []);
  const args = ffmpegMetadataArgs({ title: "Der Film", show: "Serie", season: "2", episode: "7", year: "2007", description: "Handlung" });
  const joined = args.join(" ");
  assert.match(joined, /-metadata title=Der Film/);
  assert.match(joined, /-metadata show=Serie/);
  assert.match(joined, /-metadata season_number=2/);
  assert.match(joined, /-metadata episode_sort=7/);
  assert.match(joined, /-metadata date=2007/);
  assert.match(joined, /-metadata description=Handlung/);
});

test("Folgentitel wird der Titel – sonst zeigt jede Folge den Seriennamen", () => {
  const args = ffmpegMetadataArgs({ show: "Serie", season: "1", episode: "2", episodeTitle: "Der Anfang", title: "Serie" }).join(" ");
  assert.match(args, /title=Der Anfang/);
  assert.equal(metadataSummary({ show: "Serie", episodeTitle: "Der Anfang", season: "1", episode: "2" }), "Serie · Der Anfang · S01E02");
});

test("Dateinamen erkennen, was sie hergeben", () => {
  const serie = guessFromName("Meine.Serie.S01E02.Der.Anfang.1080p.mkv");
  assert.equal(serie.title, "Meine Serie");
  assert.equal(serie.season, "1");
  assert.equal(serie.episode, "2");
  const deutsch = guessFromName("Tatort - Staffel 3 Folge 12 (2007).avi");
  assert.equal(deutsch.title, "Tatort");
  assert.equal(deutsch.year, "2007");
  assert.equal(deutsch.season, "3");
  assert.equal(deutsch.episode, "12");
  const einfach = guessFromName("Reisefilm 2019.mp4");
  assert.equal(einfach.title, "Reisefilm");
  assert.equal(einfach.year, "2019");
  assert.equal(guessFromName("clip.mkv").title, "clip");
});

test("Für die Web-Engine: Seriennummern hängen am Container", () => {
  const tags = mediabunnyTags({ show: "Serie", season: "2", episode: "3", title: "Folge" }, true);
  assert.deepEqual(tags.raw, { tvsh: "Serie", tvsn: "2", tves: "3" });
  const mp4Tags = mediabunnyTags({ show: "Serie", season: "2", episode: "3", title: "Folge" }, false);
  assert.deepEqual(mp4Tags.raw, { tvsh: "Serie" });
  assert.equal(mp4Tags.title, "Folge");
  assert.equal(isMetadataEmpty({}), true);
  assert.equal(isMetadataEmpty({ title: "x" }), false);
});

test("Die Oberfläche sagt, was in diesem Format wirklich geschrieben wird", () => {
  const desktop = metadataSupport({ metadata: true, cover: true }, "mp4");
  assert.equal(desktop.fields, true);
  assert.equal(desktop.seriesNumbers, true);
  assert.equal(desktop.cover, true);
  assert.equal(desktop.note, "");

  const web = metadataSupport({ metadata: true, cover: false }, "mp4");
  assert.equal(web.seriesNumbers, false);
  assert.match(web.note, /Desktop-App/);

  const ts = metadataSupport({ metadata: true, cover: true }, "ts");
  assert.equal(ts.fields, false);
  assert.match(ts.note, /führt keine Metadaten/);
});

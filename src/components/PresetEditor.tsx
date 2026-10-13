import { Film, Image as ImageIcon, Music, SlidersHorizontal, Terminal, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { buildFfmpegCommand } from "../lib/ffmpeg";
import {
  AUDIO_CODEC_LABEL,
  AUDIO_CONTAINERS,
  CONTAINERS,
  LEVELS,
  QUALITY_STOPS,
  VIDEO_CODEC_LABEL,
  VIDEO_CONTAINERS,
  qualityLabel,
} from "../lib/formats";
import { withContainer } from "../lib/presets";
import type {
  AudioCodecId,
  AudioSettings,
  Capabilities,
  ContainerId,
  HardwareInfo,
  Preset,
  VideoCodecId,
  VideoSettings,
} from "../lib/types";
import { cn } from "../utils/cn";
import { PRESET_ICON_IDS, PresetIcon } from "./PresetIcon";
import { Btn, Group, NumberField, RevertMark, Row, Segmented, Select, Sheet, Slider, Switch } from "./ui";

const RES_PRESETS = ["2160", "1440", "1080", "720", "480", "360"];

function resId(v: VideoSettings): string {
  if (!v.maxWidth && !v.maxHeight) return "original";
  if (!v.maxWidth && RES_PRESETS.includes(String(v.maxHeight))) return String(v.maxHeight);
  return "custom";
}

const SAMPLE_RATES = [
  { value: 0, label: "Original" },
  { value: 22050, label: "22,05 kHz" },
  { value: 32000, label: "32 kHz" },
  { value: 44100, label: "44,1 kHz" },
  { value: 48000, label: "48 kHz" },
  { value: 96000, label: "96 kHz" },
];

const AUDIO_BITRATES = [64, 96, 128, 160, 192, 256, 320];

/** Kategorien des Editors. Was nichts bewirken kann, erscheint gar nicht erst. */
type SectionId = "format" | "video" | "bild" | "ton" | "experten" | "befehl";

/**
 * Pfad zu einem einzelnen Wert im Preset. Alle diese Werte sind primitiv,
 * deshalb reicht `!==` für den Vergleich mit dem gespeicherten Stand.
 */
type Field =
  | "name"
  | "icon"
  | "container"
  | "fastStart"
  | "metadata"
  | "subtitles"
  | `video.${keyof VideoSettings}`
  | `audio.${keyof AudioSettings}`;

function readField(p: Preset, f: Field): string | number | boolean {
  const dot = f.indexOf(".");
  if (dot < 0) return (p as unknown as Record<string, string | number | boolean>)[f];
  const group = f.slice(0, dot) as "video" | "audio";
  return (p[group] as unknown as Record<string, string | number | boolean>)[f.slice(dot + 1)];
}

export function PresetEditor({
  preset: original,
  isNew,
  caps,
  hardware,
  hwOn,
  onFinish,
  onClose,
}: {
  /** Ausgangszustand. Gearbeitet wird auf einer Kopie – gespeichert wird erst mit „Fertig". */
  preset: Preset;
  /** Ein Preset, das es noch nicht gibt: entsteht erst beim Speichern. */
  isNew: boolean;
  caps: Capabilities;
  hardware: HardwareInfo;
  hwOn: boolean;
  /** „Fertig": speichert den Entwurf und schließt. */
  onFinish: (p: Preset) => void;
  /** „Abbrechen": schließt ohne zu speichern. */
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Preset>(original);
  /** Der Rest der Komponente arbeitet auf dem Entwurf. */
  const preset = draft;
  const [copied, setCopied] = useState(false);
  const [section, setSection] = useState<SectionId>("format");

  const c = CONTAINERS[preset.container];
  const v = preset.video;
  const a = preset.audio;
  const isVideoContainer = c.kind === "video";
  const encodingVideo = isVideoContainer && v.codec !== "copy" && v.codec !== "none";
  /** „Kein Video" braucht keine Video-Kategorie – ein reiner Audio-Container erst recht nicht. */
  const showsVideo = isVideoContainer && v.codec !== "none";
  const isH264 = v.codec === "h264";
  const isH26x = isH264 || v.codec === "h265";
  const lossyAudio = a.codec !== "copy" && a.codec !== "none" && a.codec !== "flac" && a.codec !== "pcm";
  const encodesAudio = a.codec !== "copy" && a.codec !== "none";

  const set = (patch: Partial<Preset>) => setDraft((d) => ({ ...d, ...patch }));
  const setV = (patch: Partial<VideoSettings>) => setDraft((d) => ({ ...d, video: { ...d.video, ...patch } }));
  const setA = (patch: Partial<AudioSettings>) => setDraft((d) => ({ ...d, audio: { ...d.audio, ...patch } }));

  /**
   * Ein Wert weicht ab? Dann zeigt die Zeile den Haken – und ein Klick darauf
   * stellt genau diesen Wert zurück, nicht das ganze Preset.
   */
  const field = (...fields: Field[]) => ({
    changed: fields.some((f) => readField(draft, f) !== readField(original, f)),
    onRevert: () =>
      setDraft((d) => {
        let next = d;
        for (const f of fields) {
          const dot = f.indexOf(".");
          if (dot >= 0) {
            if (f.startsWith("video.")) next = { ...next, video: { ...next.video, [f.slice(6)]: readField(original, f) } };
            else next = { ...next, audio: { ...next.audio, [f.slice(6)]: readField(original, f) } };
          } else if (f === "container") {
            // Der Container zieht die Codecs nach sich – zurück über denselben Weg wie hin.
            next = withContainer(next, original.container);
          } else {
            next = { ...next, [f]: readField(original, f) };
          }
        }
        return next;
      }),
  });

  const sections = useMemo(() => {
    const list: { id: SectionId; label: string; icon: ReactNode }[] = [
      { id: "format", label: "Format", icon: <Film className="h-4 w-4" /> },
    ];
    if (showsVideo) list.push({ id: "video", label: "Video", icon: <Video className="h-4 w-4" /> });
    if (encodingVideo) {
      list.push({ id: "bild", label: "Bild", icon: <ImageIcon className="h-4 w-4" /> });
      list.push({ id: "experten", label: "Experten", icon: <SlidersHorizontal className="h-4 w-4" /> });
    }
    list.push({ id: "ton", label: "Ton", icon: <Music className="h-4 w-4" /> });
    list.push({ id: "befehl", label: "Befehl", icon: <Terminal className="h-4 w-4" /> });
    return list;
  }, [showsVideo, encodingVideo]);

  /* Fällt eine Kategorie weg – etwa durch einen Containerwechsel – springt die Auswahl zurück. */
  useEffect(() => {
    if (!sections.some((s) => s.id === section)) setSection(sections[0].id);
  }, [sections, section]);

  const videoCodecOptions = useMemo(() => {
    const list: VideoCodecId[] = c.video.filter(
      (k) => !caps.ready || caps.video.length === 0 || caps.video.includes(k) || k === v.codec
    );
    return [...list, "copy" as const, "none" as const].map((k) => ({ value: k, label: VIDEO_CODEC_LABEL[k] }));
  }, [c, caps, v.codec]);

  const audioCodecOptions = useMemo(() => {
    const list: AudioCodecId[] = c.audio.filter(
      (k) => !caps.ready || caps.audio.length === 0 || caps.audio.includes(k) || k === a.codec
    );
    const extra: AudioCodecId[] = isVideoContainer ? ["copy", "none"] : [];
    return [...list, ...extra].map((k) => ({ value: k, label: AUDIO_CODEC_LABEL[k] }));
  }, [c, caps, a.codec, isVideoContainer]);

  const bitrateOptions = useMemo(() => {
    const all = new Set([...AUDIO_BITRATES, a.bitrate]);
    return [...all].sort((x, y) => x - y).map((n) => ({ value: n, label: `${n} kb/s` }));
  }, [a.bitrate]);

  const command = useMemo(() => buildFfmpegCommand(preset, hardware, hwOn), [preset, hardware, hwOn]);

  const containerGroups = [
    { label: "Video", options: VIDEO_CONTAINERS.map((id) => ({ value: id, label: CONTAINERS[id].label })) },
    { label: "Audio", options: AUDIO_CONTAINERS.map((id) => ({ value: id, label: CONTAINERS[id].label })) },
  ];
  const levelOptions = LEVELS.map((l) => ({ value: l, label: l === "auto" ? "Automatisch" : l }));
  const res = resId(v);
  /**
   * Die Auswahl steuert zwei Werte, zeigt aber nur die Stufe. Der Haken richtet sich
   * deshalb nach der Stufe – sonst meldet „Auflösung" eine Änderung, die nur die
   * Breite darunter betrifft, und die hätte ihren eigenen Haken.
   */
  const resolutionField = {
    changed: res !== resId(original.video),
    onRevert: field("video.maxWidth", "video.maxHeight").onRevert,
  };

  /* ───────── Kategorien ───────── */

  const formatSection = (
    <Group>
      <Row label="Format" {...field("container")}>
        <Select<ContainerId>
          value={preset.container}
          groups={containerGroups}
          onChange={(id) => setDraft(withContainer(preset, id))}
        />
      </Row>
      {(preset.container === "mp4" || preset.container === "mov") && (
        <Row label="Schnellstart" sub="Datei ist sofort abspielbar, auch beim Streamen" {...field("fastStart")}>
          <Switch checked={preset.fastStart} onChange={(f) => set({ fastStart: f })} />
        </Row>
      )}
      <Row label="Metadaten" {...field("metadata")}>
        <Select
          value={preset.metadata}
          options={[
            { value: "keep", label: "Beibehalten" },
            { value: "strip", label: "Entfernen" },
          ]}
          onChange={(m) => set({ metadata: m })}
        />
      </Row>
      {isVideoContainer && caps.subtitles && (
        <Row label="Untertitel" {...field("subtitles")}>
          <Select
            value={preset.subtitles}
            options={[
              { value: "keep", label: "Beibehalten" },
              { value: "burn", label: "Einbrennen" },
              { value: "none", label: "Entfernen" },
            ]}
            onChange={(s) => set({ subtitles: s })}
          />
        </Row>
      )}
      <Row label="Symbol" {...field("icon")}>
        <div className="flex gap-1">
          {PRESET_ICON_IDS.map((id) => (
            <button
              key={id}
              onClick={() => set({ icon: id })}
              aria-label={id}
              className={cn(
                "rounded-[10px] p-[3px] ring-2 transition",
                id === preset.icon ? "ring-accent" : "opacity-70 ring-transparent hover:opacity-100"
              )}
            >
              <PresetIcon icon={id} size={26} />
            </button>
          ))}
        </div>
      </Row>
    </Group>
  );

  const videoSection = (
    <Group
      footer={
        v.codec === "copy"
          ? "Das Bild wird nicht neu kodiert – das ist schneller und verlustfrei. Weitere Einstellungen entfallen."
          : undefined
      }
    >
      <Row label="Codec" {...field("video.codec")}>
        <Select<VideoCodecId> value={v.codec} options={videoCodecOptions} onChange={(k) => setV({ codec: k })} />
      </Row>
      {encodingVideo && (
        <>
          <Row label="Ratensteuerung" {...field("video.rateControl")}>
            <Segmented
              value={v.rateControl}
              onChange={(r) => setV({ rateControl: r })}
              options={[
                { value: "quality", label: "Qualität" },
                { value: "vbr", label: "Variabel" },
                { value: "cbr", label: "Konstant" },
              ]}
            />
          </Row>
          {v.rateControl === "quality" ? (
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="text-[14px]">Qualität</span>
                  {field("video.quality").changed && (
                    <RevertMark onRevert={field("video.quality").onRevert} label="Qualität" />
                  )}
                </span>
                <span className="tnum text-[14px] text-label2">{qualityLabel(v.quality)}</span>
              </div>
              <Slider value={v.quality} step={1} onChange={(q) => setV({ quality: q })} className="mt-1" />
              <div className="-mt-0.5 flex justify-between px-0.5 text-[11px] text-label2">
                {QUALITY_STOPS.map((s) => (
                  <span key={s.value}>{s.label}</span>
                ))}
              </div>
            </div>
          ) : (
            <>
              <Row label="Bitrate" {...field("video.bitrate")}>
                <NumberField
                  value={v.bitrate}
                  min={64}
                  max={200000}
                  suffix="kb/s"
                  onChange={(n) => setV({ bitrate: Math.round(n) })}
                />
              </Row>
              {v.rateControl === "vbr" && (
                <Row label="Maximale Bitrate" sub="0 lässt dem Encoder freie Hand" {...field("video.maxBitrate")}>
                  <NumberField
                    value={v.maxBitrate}
                    min={0}
                    max={400000}
                    suffix="kb/s"
                    onChange={(n) => setV({ maxBitrate: Math.round(n) })}
                  />
                </Row>
              )}
              <Row label="Zwei Durchgänge" sub="Dauert doppelt so lang, verteilt die Bits gleichmäßiger" {...field("video.twoPass")}>
                <Switch checked={v.twoPass} onChange={(t) => setV({ twoPass: t })} />
              </Row>
            </>
          )}
          {isH264 && (
            <Row label="Profil" {...field("video.profile")}>
              <Select
                value={v.profile}
                options={[
                  { value: "auto", label: "Automatisch" },
                  { value: "baseline", label: "Baseline" },
                  { value: "main", label: "Main" },
                  { value: "high", label: "High" },
                ]}
                onChange={(p) =>
                  setV(p === "baseline" ? { profile: p, bframes: 0, entropy: "cavlc" } : { profile: p })
                }
              />
            </Row>
          )}
          {isH26x && (
            <Row label="Level" {...field("video.level")}>
              <Select value={v.level} options={levelOptions} onChange={(l) => setV({ level: l })} />
            </Row>
          )}
          <Row label="Encoder-Tempo" sub="Langsam bedeutet kleinere Dateien bei gleicher Qualität" {...field("video.speed")}>
            <Select
              value={v.speed}
              options={[
                { value: "fast", label: "Schnell" },
                { value: "balanced", label: "Ausgewogen" },
                { value: "slow", label: "Langsam, kleiner" },
              ]}
              onChange={(s) => setV({ speed: s })}
            />
          </Row>
        </>
      )}
    </Group>
  );

  const bildSection = (
    <>
      <Group title="Größe">
        <Row label="Auflösung" {...resolutionField}>
          <Select
            value={res}
            options={[
              { value: "original", label: "Original" },
              { value: "2160", label: "4K · 2160p" },
              { value: "1440", label: "1440p" },
              { value: "1080", label: "1080p" },
              { value: "720", label: "720p" },
              { value: "480", label: "480p" },
              { value: "360", label: "360p" },
              { value: "custom", label: "Eigene Größe" },
            ]}
            onChange={(id) => {
              if (id === "original") setV({ maxWidth: 0, maxHeight: 0 });
              else if (id === "custom") setV({ maxWidth: v.maxWidth || 640, maxHeight: v.maxHeight || 480 });
              else setV({ maxWidth: 0, maxHeight: Number(id) });
            }}
          />
        </Row>
        {res === "custom" && (
          <>
            <Row label="Breite (max.)" {...field("video.maxWidth")}>
              <NumberField value={v.maxWidth} min={0} max={8192} suffix="px" onChange={(n) => setV({ maxWidth: Math.round(n) })} />
            </Row>
            <Row label="Höhe (max.)" {...field("video.maxHeight")}>
              <NumberField value={v.maxHeight} min={0} max={8192} suffix="px" onChange={(n) => setV({ maxHeight: Math.round(n) })} />
            </Row>
          </>
        )}
        {v.maxWidth > 0 && v.maxHeight > 0 && (
          <Row label="Skalierung" sub="Was passiert, wenn das Seitenverhältnis nicht passt" {...field("video.scaling")}>
            <Select
              value={v.scaling}
              options={[
                { value: "fit", label: "Einpassen" },
                { value: "pad", label: "Mit Balken" },
                { value: "crop", label: "Zuschneiden" },
                { value: "stretch", label: "Strecken" },
              ]}
              onChange={(s) => setV({ scaling: s })}
            />
          </Row>
        )}
        <Row label="Bildrate (max.)" {...field("video.fps")}>
          <Select
            value={v.fps}
            options={[
              { value: 0, label: "Original" },
              { value: 24, label: "24 fps" },
              { value: 25, label: "25 fps" },
              { value: 30, label: "30 fps" },
              { value: 50, label: "50 fps" },
              { value: 60, label: "60 fps" },
            ]}
            onChange={(f) => setV({ fps: f })}
          />
        </Row>
      </Group>
      <Group title="Bildverarbeitung">
        <Row label="Zeilensprung entfernen" sub="Für Material aus alten Kameras und TV-Aufnahmen" {...field("video.deinterlace")}>
          <Switch checked={v.deinterlace} onChange={(d) => setV({ deinterlace: d })} />
        </Row>
        <Row label="10 Bit Farbtiefe" {...field("video.tenBit")}>
          <Switch checked={v.tenBit} onChange={(t) => setV({ tenBit: t })} />
        </Row>
        <Row label="HDR zu SDR umrechnen" sub="Für Bildschirme ohne HDR" {...field("video.hdrToSdr")}>
          <Switch checked={v.hdrToSdr} onChange={(h) => setV({ hdrToSdr: h })} />
        </Row>
      </Group>
    </>
  );

  const tonSection = (
    <Group
      footer={
        a.codec === "none"
          ? "Die Datei bekommt keinen Ton."
          : a.codec === "copy"
            ? "Der Ton wird unverändert übernommen – schneller und ohne Qualitätsverlust."
            : undefined
      }
    >
      <Row label="Codec" {...field("audio.codec")}>
        <Select<AudioCodecId> value={a.codec} options={audioCodecOptions} onChange={(k) => setA({ codec: k })} />
      </Row>
      {encodesAudio && (
        <>
          {lossyAudio && (
            <Row label="Qualität" {...field("audio.bitrate")}>
              <Select value={a.bitrate} options={bitrateOptions} onChange={(n) => setA({ bitrate: n })} />
            </Row>
          )}
          <Row label="Abtastrate" {...field("audio.sampleRate")}>
            <Select value={a.sampleRate} options={SAMPLE_RATES} onChange={(n) => setA({ sampleRate: n })} />
          </Row>
          <Row label="Kanäle" {...field("audio.channels")}>
            <Select
              value={a.channels}
              options={[
                { value: 0, label: "Original" },
                { value: 1, label: "Mono" },
                { value: 2, label: "Stereo" },
                { value: 6, label: "5.1 Surround" },
              ]}
              onChange={(n) => setA({ channels: n })}
            />
          </Row>
          <Row label="Lautstärke angleichen" sub="Alle Dateien etwa gleich laut" {...field("audio.normalize")}>
            <Switch checked={a.normalize} onChange={(n) => setA({ normalize: n })} />
          </Row>
        </>
      )}
    </Group>
  );

  const expertenSection = (
    <Group title="Kodierung" footer="Diese Werte lässt man normalerweise, wie sie sind.">
      <Row label="Keyframe-Abstand" {...field("video.keyframeInterval")}>
        <NumberField
          value={v.keyframeInterval}
          min={0.5}
          max={30}
          width={64}
          suffix="Sek."
          onChange={(n) => setV({ keyframeInterval: n })}
        />
      </Row>
      {isH26x && (
        <Row label="B-Frames" {...field("video.bframes")}>
          <NumberField value={v.bframes} min={0} max={4} width={64} onChange={(n) => setV({ bframes: Math.round(n) })} />
        </Row>
      )}
      {isH264 && (
        <>
          <Row label="Referenzbilder" {...field("video.refs")}>
            <NumberField value={v.refs} min={1} max={16} width={64} onChange={(n) => setV({ refs: Math.round(n) })} />
          </Row>
          <Row label="Entropiekodierung" {...field("video.entropy")}>
            <Select
              value={v.entropy}
              options={[
                { value: "cabac", label: "CABAC" },
                { value: "cavlc", label: "CAVLC" },
              ]}
              onChange={(e) => setV({ entropy: e })}
            />
          </Row>
        </>
      )}
    </Group>
  );

  const befehlSection = (
    <Group
      title="FFmpeg-Befehl"
      footer="Vorschau des Befehls, den die Windows-Version ausführt. Die Web-Version kodiert mit WebCodecs im Browser."
    >
      <div className="p-3">
        <pre className="select-text whitespace-pre-wrap break-all rounded-lg bg-fill p-3 font-mono text-[11.5px] leading-relaxed">
          {command}
        </pre>
        <div className="mt-2 flex justify-end">
          <Btn
            size="sm"
            onClick={() => {
              navigator.clipboard?.writeText(command).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Kopiert" : "Kopieren"}
          </Btn>
        </div>
      </div>
    </Group>
  );

  const content =
    section === "format"
      ? formatSection
      : section === "video"
        ? videoSection
        : section === "bild"
          ? bildSection
          : section === "ton"
            ? tonSection
            : section === "experten"
              ? expertenSection
              : befehlSection;

  return (
    <Sheet title={isNew ? "Neues Preset" : `${original.name} bearbeiten`} onClose={onClose} width={680} height={680}>
      <header className="px-6 pb-4 pt-6">
        <div className="flex items-center gap-4">
          <PresetIcon icon={preset.icon} size={44} />
          <input
            value={preset.name}
            onChange={(e) => set({ name: e.target.value })}
            onFocus={(e) => {
              if (/^Neues Preset$|Kopie$/.test(preset.name)) e.currentTarget.select();
            }}
            autoFocus={/^Neues Preset$|Kopie$/.test(preset.name)}
            onBlur={() => !preset.name.trim() && set({ name: "Ohne Namen" })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="Name"
            aria-label="Name des Presets"
            className="-mx-2 min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-[20px] font-semibold tracking-tight transition placeholder:text-label3 hover:bg-fill focus:bg-fill"
          />
          {field("name").changed && <RevertMark onRevert={field("name").onRevert} label="Name" />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Kategorien" className="w-[152px] shrink-0 space-y-0.5 overflow-y-auto border-r border-sep px-2.5 py-1">
          {sections.map(({ id, label, icon }) => {
            const active = section === id;
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-[13.5px] transition-colors",
                  active ? "bg-fill font-medium text-label" : "text-label2 hover:text-label"
                )}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center", active ? "text-accent" : "text-label3")}>
                  {icon}
                </span>
                {label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">{content}</div>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-sep px-6 py-3">
        <Btn variant="secondary" onClick={onClose}>
          Abbrechen
        </Btn>
        <Btn variant="primary" onClick={() => onFinish(draft)}>
          Fertig
        </Btn>
      </footer>
    </Sheet>
  );
}

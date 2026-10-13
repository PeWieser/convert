import { Copy, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { factoryPreset, withContainer } from "../lib/presets";
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
import { Btn, Group, NumberField, Row, Segmented, Select, Sheet, Slider, Switch } from "./ui";

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

export function PresetEditor({
  preset: original,
  isNew,
  caps,
  hardware,
  hwOn,
  canDelete,
  onSave,
  onDuplicate,
  onDelete,
  onClose,
}: {
  /** Ausgangszustand. Gearbeitet wird auf einer Kopie – gespeichert wird erst auf Wunsch. */
  preset: Preset;
  /** Ein Preset, das es noch nicht gibt: entsteht erst beim Speichern. */
  isNew: boolean;
  caps: Capabilities;
  hardware: HardwareInfo;
  hwOn: boolean;
  canDelete: boolean;
  onSave: (p: Preset) => void;
  onDuplicate: (current: Preset) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Preset>(original);
  /** Der Rest der Komponente arbeitet auf dem Entwurf. */
  const preset = draft;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(original), [draft, original]);
  const [mode, setModeState] = useState<"simple" | "pro">(() =>
    localStorage.getItem("wandler.editorMode") === "pro" ? "pro" : "simple"
  );
  const setMode = (m: "simple" | "pro") => {
    setModeState(m);
    try {
      localStorage.setItem("wandler.editorMode", m);
    } catch {
      /* ignorieren */
    }
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const c = CONTAINERS[preset.container];
  const v = preset.video;
  const a = preset.audio;
  const isVideoContainer = c.kind === "video";
  const encodingVideo = isVideoContainer && v.codec !== "copy" && v.codec !== "none";
  const isH264 = v.codec === "h264";
  const isH26x = isH264 || v.codec === "h265";
  const lossyAudio = a.codec !== "copy" && a.codec !== "none" && a.codec !== "flac" && a.codec !== "pcm";

  const set = (patch: Partial<Preset>) => setDraft((d) => ({ ...d, ...patch }));
  const setV = (patch: Partial<VideoSettings>) => setDraft((d) => ({ ...d, video: { ...d.video, ...patch } }));
  const setA = (patch: Partial<AudioSettings>) => setDraft((d) => ({ ...d, audio: { ...d.audio, ...patch } }));

  /** Werkseinstellung – ändert den Entwurf, nicht das gespeicherte Preset. */
  const resetDraft = () => {
    if (preset.builtin) setDraft({ ...factoryPreset(preset.builtin), id: preset.id });
  };

  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose());

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
    const set = new Set([...AUDIO_BITRATES, a.bitrate]);
    return [...set].sort((x, y) => x - y).map((n) => ({ value: n, label: `${n} kb/s` }));
  }, [a.bitrate]);

  const command = useMemo(() => buildFfmpegCommand(preset, hardware, hwOn), [preset, hardware, hwOn]);

  const containerGroups = [
    { label: "Video", options: VIDEO_CONTAINERS.map((id) => ({ value: id, label: CONTAINERS[id].label })) },
    { label: "Audio", options: AUDIO_CONTAINERS.map((id) => ({ value: id, label: CONTAINERS[id].label })) },
  ];

  const levelOptions = LEVELS.map((l) => ({ value: l, label: l === "auto" ? "Automatisch" : l }));

  const formatRow = (
    <Row label="Format">
      <Select<ContainerId>
        value={preset.container}
        groups={containerGroups}
        onChange={(id) => setDraft(withContainer(preset, id))}
      />
    </Row>
  );

  const qualityRow = (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px]">Qualität</span>
        <span className="tnum text-[14px] text-label2">{qualityLabel(v.quality)}</span>
      </div>
      <Slider
        value={v.quality}
        step={mode === "simple" ? 25 : 1}
        onChange={(q) => setV({ quality: q })}
        className="mt-1"
      />
      {mode === "simple" && (
        <div className="-mt-0.5 flex justify-between px-0.5 text-[11px] text-label2">
          {QUALITY_STOPS.map((s) => (
            <span key={s.value}>{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );

  const bitrateRow = (
    <Row label="Bitrate">
      <NumberField value={v.bitrate} min={64} max={200000} suffix="kb/s" onChange={(n) => setV({ bitrate: Math.round(n) })} />
    </Row>
  );

  const res = resId(v);

  return (
    <Sheet
      title={isNew ? "Neues Preset" : dirty ? `${original.name} bearbeiten, ungespeichert` : `${original.name} bearbeiten`}
      onClose={onClose}
      onCloseRequest={requestClose}
      width={600}
    >
      <header className="px-6 pb-3 pt-6">
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
          <Btn variant="primary" onClick={() => (dirty ? onSave(draft) : onClose())}>
            {dirty ? "Speichern" : "Fertig"}
          </Btn>
        </div>
        <div className="mt-4 flex justify-center">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "simple", label: "Einfach" },
              { value: "pro", label: "Profi" },
            ]}
            className="min-w-[200px]"
          />
        </div>
        <p
          className={cn(
            "mt-3 text-center text-[12px] transition-opacity duration-200",
            dirty ? "text-warn opacity-100" : "opacity-0"
          )}
          role="status"
        >
          Ungespeicherte Änderungen
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6 pt-2">
        {mode === "simple" ? (
          <>
            <Group>
              {formatRow}
              <Row label="Symbol">
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

            {encodingVideo && (
              <Group title="Video">
                {v.rateControl === "quality" ? qualityRow : bitrateRow}
                <Row label="Auflösung">
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
                    <Row label="Breite (max.)">
                      <NumberField value={v.maxWidth} min={0} max={8192} suffix="px" onChange={(n) => setV({ maxWidth: Math.round(n) })} />
                    </Row>
                    <Row label="Höhe (max.)">
                      <NumberField value={v.maxHeight} min={0} max={8192} suffix="px" onChange={(n) => setV({ maxHeight: Math.round(n) })} />
                    </Row>
                  </>
                )}
              </Group>
            )}

            {lossyAudio && (
              <Group title="Ton">
                <Row label="Qualität">
                  <Select value={a.bitrate} options={bitrateOptions} onChange={(n) => setA({ bitrate: n })} />
                </Row>
              </Group>
            )}
          </>
        ) : (
          <>
            <Group title="Container">
              {formatRow}
              {(preset.container === "mp4" || preset.container === "mov") && (
                <Row label="Schnellstart">
                  <Switch checked={preset.fastStart} onChange={(f) => set({ fastStart: f })} />
                </Row>
              )}
              <Row label="Metadaten">
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
                <Row label="Untertitel">
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
            </Group>

            {isVideoContainer && (
              <Group title="Video">
                <Row label="Codec">
                  <Select<VideoCodecId> value={v.codec} options={videoCodecOptions} onChange={(k) => setV({ codec: k })} />
                </Row>
                {encodingVideo && (
                  <>
                    <Row label="Ratensteuerung">
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
                      qualityRow
                    ) : (
                      <>
                        {bitrateRow}
                        {v.rateControl === "vbr" && (
                          <Row label="Maximale Bitrate">
                            <NumberField
                              value={v.maxBitrate}
                              min={0}
                              max={400000}
                              suffix="kb/s"
                              onChange={(n) => setV({ maxBitrate: Math.round(n) })}
                            />
                          </Row>
                        )}
                        <Row label="Zwei Durchgänge">
                          <Switch checked={v.twoPass} onChange={(t) => setV({ twoPass: t })} />
                        </Row>
                      </>
                    )}
                    {isH264 && (
                      <Row label="Profil">
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
                      <Row label="Level">
                        <Select value={v.level} options={levelOptions} onChange={(l) => setV({ level: l })} />
                      </Row>
                    )}
                    <Row label="Encoder-Tempo">
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
            )}

            {encodingVideo && (
              <Group title="Bild">
                <Row label="Breite (max.)">
                  <NumberField value={v.maxWidth} min={0} max={8192} suffix="px" onChange={(n) => setV({ maxWidth: Math.round(n) })} />
                </Row>
                <Row label="Höhe (max.)">
                  <NumberField value={v.maxHeight} min={0} max={8192} suffix="px" onChange={(n) => setV({ maxHeight: Math.round(n) })} />
                </Row>
                {v.maxWidth > 0 && v.maxHeight > 0 && (
                  <Row label="Skalierung">
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
                <Row label="Bildrate (max.)">
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
                <Row label="Drehen">
                  <Select
                    value={v.rotate}
                    options={[
                      { value: 0, label: "Nicht drehen" },
                      { value: 90, label: "90° rechts" },
                      { value: 180, label: "180°" },
                      { value: 270, label: "90° links" },
                    ]}
                    onChange={(r) => setV({ rotate: r })}
                  />
                </Row>
                <Row label="Zeilensprung entfernen">
                  <Switch checked={v.deinterlace} onChange={(d) => setV({ deinterlace: d })} />
                </Row>
                <Row label="10 Bit Farbtiefe">
                  <Switch checked={v.tenBit} onChange={(t) => setV({ tenBit: t })} />
                </Row>
                <Row label="HDR zu SDR umrechnen">
                  <Switch checked={v.hdrToSdr} onChange={(h) => setV({ hdrToSdr: h })} />
                </Row>
              </Group>
            )}

            {encodingVideo && (
              <Group title="Kodierung">
                <Row label="Keyframe-Abstand">
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
                  <Row label="B-Frames">
                    <NumberField value={v.bframes} min={0} max={4} width={64} onChange={(n) => setV({ bframes: Math.round(n) })} />
                  </Row>
                )}
                {isH264 && (
                  <>
                    <Row label="Referenzbilder">
                      <NumberField value={v.refs} min={1} max={16} width={64} onChange={(n) => setV({ refs: Math.round(n) })} />
                    </Row>
                    <Row label="Entropiekodierung">
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
            )}

            <Group title="Audio">
              <Row label="Codec">
                <Select<AudioCodecId> value={a.codec} options={audioCodecOptions} onChange={(k) => setA({ codec: k })} />
              </Row>
              {a.codec !== "none" && a.codec !== "copy" && (
                <>
                  {lossyAudio && (
                    <Row label="Bitrate">
                      <Select value={a.bitrate} options={bitrateOptions} onChange={(n) => setA({ bitrate: n })} />
                    </Row>
                  )}
                  <Row label="Abtastrate">
                    <Select value={a.sampleRate} options={SAMPLE_RATES} onChange={(n) => setA({ sampleRate: n })} />
                  </Row>
                  <Row label="Kanäle">
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
                  <Row label="Lautstärke angleichen">
                    <Switch checked={a.normalize} onChange={(n) => setA({ normalize: n })} />
                  </Row>
                </>
              )}
            </Group>

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
          </>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-sep px-4 py-3">
        <div className="flex items-center gap-1">
          {dirty && (
            <Btn variant="ghost" onClick={() => setConfirmDiscard(true)}>
              Verwerfen
            </Btn>
          )}
          {!isNew && (
            <Btn variant="plain" onClick={() => onDuplicate(draft)}>
              <Copy className="h-3.5 w-3.5" /> Duplizieren
            </Btn>
          )}
          {preset.builtin && (
            <Btn variant="plain" onClick={resetDraft}>
              <RotateCcw className="h-3.5 w-3.5" /> Zurücksetzen
            </Btn>
          )}
        </div>
        {canDelete && (
          <Btn
            variant={confirmDelete ? "primary" : "danger"}
            className={confirmDelete ? "!bg-bad" : ""}
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          >
            <Trash2 className="h-3.5 w-3.5" /> {confirmDelete ? "Wirklich löschen" : "Löschen"}
          </Btn>
        )}
      </footer>
      {confirmDiscard && (
        <div className="anim-fade absolute inset-0 z-20 grid place-items-center rounded-[20px] bg-canvas/75 backdrop-blur-[3px]">
          <div className="anim-pop w-[340px] rounded-[18px] bg-surface p-5 text-center shadow-pop">
            <p className="text-[15px] font-semibold tracking-tight">Änderungen verwerfen?</p>
            <p className="mt-1.5 text-[13px] leading-snug text-label2">
              {isNew ? "Das neue Preset wird nicht angelegt." : `„${original.name}" bleibt unverändert.`}
            </p>
            <div className="mt-4 flex justify-center gap-1.5">
              <Btn variant="ghost" onClick={() => setConfirmDiscard(false)}>
                Weiter bearbeiten
              </Btn>
              <Btn variant="primary" onClick={() => onSave(draft)}>
                Sichern
              </Btn>
              <Btn variant="danger" onClick={onClose}>
                Verwerfen
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

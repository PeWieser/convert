/**
 * Eine Datei bearbeiten.
 *
 * Doppelklick auf die Datei öffnet dieses Fenster. Es zeigt die Datei selbst –
 * nicht ihre Metadaten. Drehen, Zuschneiden und Schneiden sind hier, weil sie
 * Eigenschaften *dieser* Aufnahme sind und nicht des Zielformats.
 *
 * Geometrie: Mediabunny dreht erst, beschneidet dann, skaliert zuletzt. Das
 * Vorschaubild baut denselben Raum nach – außen eine achsenparallele Box in der
 * Größe nach der Drehung, darin das gedrehte Bild, darüber der Beschnitt. So
 * liegt das Rechteck immer waagerecht, egal wie schief die Quelle ist.
 */
import { Crop as CropIcon, Film, Maximize, Music, Pause, Play, RotateCcw, RotateCw, Scissors, Tags } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { formatDuration } from "../lib/format";
import { clampCrop, NO_ADJUSTMENTS, resolveJob, routeLabel } from "../lib/job";
import { sameMetadata } from "../lib/metadata";
import type { Adjustments, Capabilities, CropRect, FileMetadata, Item, Preset } from "../lib/types";
import { cn } from "../utils/cn";
import { Btn, RevertMark, Segmented, Sheet } from "./ui";
import { MetadataPanel } from "./MetadataPanel";

type ToolId = "play" | "rotate" | "crop" | "trim" | "meta";
type Handle = "move" | "nw" | "ne" | "sw" | "se";

const RATIOS: { id: string; label: string; value: number | null }[] = [
  { id: "free", label: "Frei", value: null },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "1:1", label: "1:1", value: 1 },
  { id: "9:16", label: "9:16", value: 9 / 16 },
];

/** Größter Beschnitt mit diesem Seitenverhältnis, mittig im Bild. */
function fitRatio(rotW: number, rotH: number, ratio: number): CropRect {
  let width = rotW;
  let height = rotW / ratio;
  if (height > rotH) {
    height = rotH;
    width = rotH * ratio;
  }
  return { left: (rotW - width) / 2, top: (rotH - height) / 2, width, height };
}

/** Verschiebt oder zieht den Beschnitt – Umklappen der Ecken erlaubt, `clampCrop` richtet es wieder her. */
function dragCrop(c0: CropRect, mode: Handle, dx: number, dy: number): CropRect {
  if (mode === "move") return { ...c0, left: c0.left + dx, top: c0.top + dy };
  let left = c0.left;
  let top = c0.top;
  let right = c0.left + c0.width;
  let bottom = c0.top + c0.height;
  if (mode === "nw" || mode === "ne") top += dy;
  if (mode === "sw" || mode === "se") bottom += dy;
  if (mode === "nw" || mode === "sw") left += dx;
  if (mode === "ne" || mode === "se") right += dx;
  return {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  };
}

export function FileInspector({
  item,
  preset,
  caps,
  tmdbKey,
  tmdbLanguage,
  onClose,
  onFinish,
  onApplyToAll,
  onApplyMetadataToAll,
  onOpenSettings,
}: {
  item: Item;
  /** Das gewählte Preset – daraus ergibt sich, was mit dem Bild und dem Ton geschieht. */
  preset: Preset;
  caps: Capabilities;
  tmdbKey: string;
  tmdbLanguage: string;
  onClose: () => void;
  /** Übernimmt den Entwurf für diese Datei – Anpassungen und Metadaten. */
  onFinish: (adj: Adjustments, metadata: FileMetadata) => void;
  /** Übernimmt den Entwurf für alle Dateien mit Bild. */
  onApplyToAll: (adj: Adjustments) => void;
  /** Serie, Jahr und Beschreibung für alle Dateien übernehmen. */
  onApplyMetadataToAll: (metadata: FileMetadata) => void;
  onOpenSettings: () => void;
}) {
  const original = item.adjustments ?? NO_ADJUSTMENTS;
  const [draft, setDraft] = useState<Adjustments>(original);
  /* Was in der Datei steht, ist der Vergleichsstand – nicht das, was zuletzt getippt wurde. */
  const fileMeta = item.info?.tags;
  const [meta, setMeta] = useState<FileMetadata>(item.metadata ?? fileMeta ?? {});
  const [tool, setTool] = useState<ToolId>("play");

  const info = item.info;
  const srcW = info?.video?.width ?? 0;
  const srcH = info?.video?.height ?? 0;
  const hasVideo = srcW > 0 && srcH > 0;
  const duration = info?.duration ?? 0;

  /* Maße nach der eigenen Drehung – in diesem Raum liegt der Beschnitt. */
  const swapped = draft.rotate === 90 || draft.rotate === 270;
  const rotW = swapped ? srcH : srcW;
  const rotH = swapped ? srcW : srcH;

  /* Bei 90/270 ist das Bild schmaler und höher als der Rahmen – genau seitenverkehrt. */
  const innerW = swapped ? `${(rotH / rotW) * 100}%` : "100%";
  const innerH = swapped ? `${(rotW / rotH) * 100}%` : "100%";

  const crop = useMemo(() => (hasVideo ? clampCrop(draft.crop ?? { left: 0, top: 0, width: rotW, height: rotH }, rotW, rotH) : undefined), [
    draft.crop,
    rotW,
    rotH,
    hasVideo,
  ]);
  const cropping = !!draft.crop;

  const t0 = draft.trim?.start ?? 0;
  const t1 = draft.trim?.end ?? duration;

  /* ── Änderungen: ein Haken pro Wert, wie im Preset-Editor ── */
  const cropChanged = cropChangedOf(draft.crop, original.crop);
  const trimChanged = (draft.trim?.start ?? 0) !== (original.trim?.start ?? 0) || (draft.trim?.end ?? 0) !== (original.trim?.end ?? 0);
  const rotateChanged = draft.rotate !== original.rotate;

  const revert = (f: "rotate" | "crop" | "trim") => {
    if (f === "rotate") return setDraft((d) => ({ ...d, rotate: original.rotate }));
    if (f === "crop") return setDraft((d) => ({ ...d, crop: original.crop }));
    return setDraft((d) => ({ ...d, trim: original.trim }));
  };

  /* ── Wiedergabe ── */
  const url = useMemo(() => item.source.native?.previewUrl ?? URL.createObjectURL(item.source.file!), [item.source.file, item.source.native]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [playable, setPlayable] = useState(true);

  useEffect(() => {
    setPlayable(true);
    setNow(0);
    setPlaying(false);
  }, [url]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  /* Leertaste spielt, die Pfeile spulen – Hände bleiben an der Tastatur. */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      if (e.key === " " && playable) {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(now - (e.shiftKey ? 1 : 5));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(now + (e.shiftKey ? 1 : 5));
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  /* Während des Zuschneidens steht das Bild, damit man sieht, was man tut. */
  useEffect(() => {
    const v = videoRef.current;
    if (v && tool === "crop") v.pause();
  }, [tool]);

  /** Ob das Ziehen auf der Leiste begonnen hat, während noch gespielt wurde. */
  const wasPlaying = useRef(false);

  /**
   * Setzt die Stelle. `start`/`end` rahmen ein Ziehen ein: anhalten, Stelle zeigen,
   * weiterspielen. So läuft das Bild beim Rutschen über die Leiste mit – in jedem
   * Werkzeug, auch beim Zuschneiden und beim Ziehen der Schnittgriffe.
   */
  const seek = (t: number, phase: "start" | "move" | "end" = "move") => {
    const v = videoRef.current;
    if (!v || !duration) return;
    if (phase === "start") {
      wasPlaying.current = !v.paused;
      v.pause();
    }
    v.currentTime = Math.max(0, Math.min(duration, t));
    setNow(v.currentTime);
    if (phase === "end" && wasPlaying.current) {
      wasPlaying.current = false;
      void v.play();
    }
  };

  /* ── Beschnitt ziehen ── */
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  /*
   * useLayoutEffect, nicht useEffect: Beim Drehen ändern sich die Maße, und ein
   * Render mit neuer Größe aber altem Maßstab ließ hochkante Bilder für ein Bild
   * aus dem Rahmen laufen – und zwar so, dass es aussehen konnte wie ein
   * abgeschnittener Film. Vor dem Malen messen, dann passiert das nicht.
   */
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || !rotW || !rotH) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.01, Math.min((r.width - 56) / rotW, (r.height - 56) / rotH)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rotW, rotH]);

  const drag = useRef<{ mode: Handle; x0: number; y0: number; c0: CropRect } | null>(null);
  const [pulling, setPulling] = useState(false);
  useEffect(() => {
    if (!pulling || !drag.current) return;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || !scale) return;
      const next = dragCrop(d.c0, d.mode, (e.clientX - d.x0) / scale, (e.clientY - d.y0) / scale);
      setDraft((prev) => ({ ...prev, crop: clampCrop(next, rotW, rotH) }));
    };
    const up = () => {
      drag.current = null;
      setPulling(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [pulling, scale, rotW, rotH]);

  const startDrag = (mode: Handle) => (e: ReactPointerEvent) => {
    if (!crop) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, x0: e.clientX, y0: e.clientY, c0: crop };
    setPulling(true);
  };

  /* ── Werkzeugleiste ── */
  /* Geändert gegenüber der Datei – derselbe Haken wie bei den Anpassungen. */
  const metaChanged = !sameMetadata(meta, fileMeta);

  const tools: { id: ToolId; label: string; icon: ReactNode; changed: boolean }[] = [
    { id: "play", label: "Wiedergabe", icon: <Play className="h-4 w-4" strokeWidth={2} />, changed: false },
    ...(hasVideo
      ? ([
          { id: "rotate", label: "Drehen", icon: <RotateCw className="h-4 w-4" strokeWidth={2} />, changed: rotateChanged },
          { id: "crop", label: "Zuschneiden", icon: <CropIcon className="h-4 w-4" strokeWidth={2} />, changed: cropChanged },
        ] as const)
      : []),
    { id: "trim", label: "Schneiden", icon: <Scissors className="h-4 w-4" strokeWidth={2} />, changed: trimChanged },
    { id: "meta", label: "Metadaten", icon: <Tags className="h-4 w-4" strokeWidth={2} />, changed: metaChanged },
  ];

  // Fällt das Bild weg (Tondatei), gibt es nichts zu drehen oder zu beschneiden.
  useEffect(() => {
    if (!hasVideo && (tool === "rotate" || tool === "crop")) setTool("play");
  }, [hasVideo, tool]);

  const dirty = rotateChanged || cropChanged || trimChanged || metaChanged;

  /*
   * Was mit dieser Datei wirklich geschieht: Bei einer TS-Datei in MP4 ist das
   * die Frage, ob neu gerechnet wird. Sie wird hier beantwortet – mit demselben
   * `resolveJob`, den beide Engines benutzen.
   */
  const route = useMemo(() => (info ? resolveJob(preset, info, draft) : undefined), [preset, info, draft]);
  const routeText = route ? routeLabel(route.route) : "";
  const lossless = !!route && route.route.video !== "encode" && route.route.audio !== "encode";

  /**
   * Der Beschnitt wird im Werkzeug immer als Vollbildrahmen angezeigt, auch wenn
   * niemand ihn angefasst hat. Gespeichert wird er nur, wenn er wirklich schneidet.
   */
  const finish = () => {
    const next: Adjustments = { ...draft };
    if (crop && (crop.width < rotW - 2 || crop.height < rotH - 2)) next.crop = crop;
    else delete next.crop;
    if (next.trim && !next.trim.start && (!next.trim.end || next.trim.end >= duration - 0.05)) delete next.trim;
    onFinish(next, meta);
  };

  return (
    <Sheet title={`${item.source.name} bearbeiten`} onClose={onClose} width={900} height={700}>
      <header className="px-6 pb-4 pt-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-fill text-label2">
            {hasVideo ? <Film className="h-5 w-5" strokeWidth={1.8} /> : <Music className="h-5 w-5" strokeWidth={1.8} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[20px] font-semibold tracking-tight" title={item.source.name}>
              {item.source.name}
            </div>
            <div className="mt-0.5 truncate text-[12.5px] text-label2">
              {hasVideo
                ? [`${srcW} × ${srcH}`, duration ? formatDuration(duration) : ""].filter(Boolean).join(" · ")
                : duration
                  ? formatDuration(duration)
                  : " "}
            </div>
            {/* Der Weg dieser Datei: kopiert oder neu gerechnet – und warum. */}
            {info && (
              <div className="mt-1 flex items-center gap-1.5 truncate text-[12px] text-label2" title={route?.route.note}>
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap text-[11px]",
                    routeText === "Ohne Qualitätsverlust" || routeText === "Ton bleibt, wie er ist"
                      ? "text-label3"
                      : "rounded-full bg-warn/12 px-1.5 py-[1px] font-medium text-warn",
                    lossless && routeText !== "Ohne Qualitätsverlust" && routeText !== "Ton bleibt, wie er ist" && "bg-ok/12 text-ok"
                  )}
                >
                  {routeText}
                </span>
                <span className="truncate">{route?.route.note ?? ""}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Werkzeuge" className="w-[188px] shrink-0 space-y-0.5 overflow-y-auto border-r border-sep px-3 py-1">
          {tools.map((t) => {
            const active = tool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-[13.5px] transition-colors",
                  active ? "bg-fill font-medium text-label" : "text-label2 hover:text-label"
                )}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center", active ? "text-accent" : "text-label3")}>
                  {t.icon}
                </span>
                {t.label}
                {t.changed && <span className="ml-auto h-[6px] w-[6px] shrink-0 rounded-full bg-ok" aria-label="geändert" />}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* ── Bühne und Laufwerk: beim Metadaten-Reiter hat das Formular den Platz. ── */}
          {tool !== "meta" && (
            <>
                    {/* ── Bühne ── */}
          <div ref={stageRef} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-[#101013] p-7">
            {hasVideo && scale > 0 ? (
              <div
                className="relative"
                style={{ width: rotW * scale, height: rotH * scale }}
                onPointerDown={tool === "crop" ? startDrag("move") : undefined}
              >
                {/*
                  Bild: außen ein achsenparalleler Rahmen in der Größe nach der Drehung,
                  darin das gedrehte Bild. Der Beschnitt liegt über der Drehung.

                  Das Bild wird in Prozent des Rahmens angegeben, nicht in Pixeln aus
                  dem Maßstab. Dadurch ist es rechnerisch immer genau eingeschrieben –
                  auch in dem Moment, in dem der Maßstab selbst noch hinterherhinkt.
                  Nichts kann mehr aus dem Rahmen fallen.
                */}
                <div className="absolute inset-0">
                  {playable ? (
                    <video
                      ref={videoRef}
                      src={url}
                      className="absolute left-1/2 top-1/2 block select-none object-fill shadow-[0_6px_24px_rgba(0,0,0,0.45)]"
                      style={{ width: innerW, height: innerH, transform: `translate(-50%, -50%) rotate(${draft.rotate}deg)` }}
                      playsInline
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onTimeUpdate={(e) => {
                        const t = e.currentTarget.currentTime;
                        setNow(t);
                        if (tool === "trim" && t1 < duration && t >= t1) e.currentTarget.pause();
                      }}
                      onError={() => setPlayable(false)}
                      onClick={tool === "crop" ? undefined : toggle}
                    />
                  ) : item.thumb ? (
                    <img
                      src={item.thumb}
                      alt=""
                      draggable={false}
                      className="absolute left-1/2 top-1/2 block select-none object-fill"
                      style={{ width: innerW, height: innerH, transform: `translate(-50%, -50%) rotate(${draft.rotate}deg)` }}
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-[#1c1c20] text-[13px] text-white/45">
                      Kein Vorschaubild
                    </div>
                  )}
                </div>

                {/* Beschnitt */}
                {tool === "crop" && crop && (
                  <div
                    className="absolute cursor-move outline outline-1 outline-white/85"
                    style={{
                      left: crop.left * scale,
                      top: crop.top * scale,
                      width: crop.width * scale,
                      height: crop.height * scale,
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                    }}
                  >
                    {(["nw", "ne", "sw", "se"] as Handle[]).map((h) => (
                      <span
                        key={h}
                        onPointerDown={startDrag(h)}
                        className={cn(
                          "absolute h-3 w-3 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)] ring-1 ring-black/10",
                          h === "nw" && "-left-1.5 -top-1.5 cursor-nwse-resize",
                          h === "ne" && "-right-1.5 -top-1.5 cursor-nesw-resize",
                          h === "sw" && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                          h === "se" && "-bottom-1.5 -right-1.5 cursor-nwse-resize"
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : hasVideo ? null : (
              <div className="flex flex-col items-center gap-3 text-white/60">
                <Music className="h-9 w-9" strokeWidth={1.6} />
                <div className="text-[13px]">Tondatei – Schneiden geht, Drehen und Zuschneiden nicht.</div>
              </div>
            )}

            {!playable && hasVideo && (
              <div className="absolute inset-x-0 bottom-0 bg-black/55 px-4 py-2 text-center text-[12px] text-white/75">
                Dieser Browser spielt das Format nicht ab. Zuschneiden und Schneiden bleiben deshalb blind.
              </div>
            )}
          </div>

          {/* ── Laufwerk ── */}
          <div className="flex h-12 shrink-0 items-center gap-3 border-t border-sep px-4">
            <button
              onClick={toggle}
              disabled={!playable || !duration}
              aria-label={playing ? "Pause" : "Wiedergeben"}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fill text-label transition hover:bg-fill2 active:scale-90 disabled:opacity-40"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-[1px] h-4 w-4" />}
            </button>
            <span className="tnum w-[86px] shrink-0 text-[12px] text-label2">
              {formatDuration(now)} / {formatDuration(duration)}
            </span>
            <Track
              duration={duration}
              now={now}
              t0={t0}
              t1={t1}
              showTrim={tool === "trim"}
              onSeek={seek}
              onTrim={(start, end) => setDraft((d) => ({ ...d, trim: { start, end } }))}
            />
          </div>

            </>
          )}

          {/* ── Werkzeug ── */}
          {tool === "meta" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <MetadataPanel
                original={fileMeta}
                draft={meta}
                onChange={setMeta}
                onApplyToAll={() => onApplyMetadataToAll(meta)}
                caps={caps}
                preset={preset}
                sourceName={item.source.name}
                tmdbKey={tmdbKey}
                tmdbLanguage={tmdbLanguage}
                onOpenSettings={onOpenSettings}
              />
            </div>
          )}
          {tool !== "play" && tool !== "meta" && (
          <div className="shrink-0 space-y-3 border-t border-sep px-6 py-4">
            {tool === "rotate" && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setDraft((d) => ({ ...d, rotate: (((d.rotate + 270) % 360) as Adjustments["rotate"]) }))}
                    aria-label="Nach links drehen"
                    className="grid h-8 w-8 place-items-center rounded-full bg-fill text-label transition hover:bg-fill2 active:scale-90"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDraft((d) => ({ ...d, rotate: (((d.rotate + 90) % 360) as Adjustments["rotate"]) }))}
                    aria-label="Nach rechts drehen"
                    className="grid h-8 w-8 place-items-center rounded-full bg-fill text-label transition hover:bg-fill2 active:scale-90"
                  >
                    <RotateCw className="h-4 w-4" />
                  </button>
                </div>
                <span className="tnum ml-auto text-[12.5px] text-label2">
                  {rotW} × {rotH} px
                </span>
                {rotateChanged && <RevertMark onRevert={() => revert("rotate")} label="Drehung" />}
              </div>
            )}

            {tool === "crop" && crop && (
              <div className="flex items-center gap-3">
                <Segmented
                  stretch
                  className="max-w-[290px]"
                  value={activeRatio(crop, rotW, rotH)}
                  onChange={(id) => {
                    const r = RATIOS.find((x) => x.id === id)?.value ?? null;
                    setDraft((d) => ({ ...d, crop: r ? clampCrop(fitRatio(rotW, rotH, r), rotW, rotH) : undefined }));
                  }}
                  options={RATIOS.map((r) => ({ value: r.id, label: r.label }))}
                />
                <Btn
                  variant="plain"
                  size="sm"
                  onClick={() => setDraft((d) => ({ ...d, crop: undefined }))}
                  disabled={!cropping}
                >
                  <Maximize className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Ganzes Bild
                </Btn>
                <span className="tnum ml-auto text-[12.5px] text-label2">
                  {crop.width} × {crop.height}
                </span>
                {cropChanged && <RevertMark onRevert={() => revert("crop")} label="Beschnitt" />}
              </div>
            )}

            {tool === "trim" && (
              <div className="flex items-center gap-3">
                <Btn variant="plain" size="sm" onClick={() => setDraft((d) => ({ ...d, trim: { ...d.trim, start: round(now) } }))} disabled={!duration}>
                  Anfang hier
                </Btn>
                <Btn variant="plain" size="sm" onClick={() => setDraft((d) => ({ ...d, trim: { ...d.trim, end: round(now) } }))} disabled={!duration}>
                  Ende hier
                </Btn>
                <span className="tnum ml-auto text-[12.5px] text-label2">
                  {formatDuration(t0)} – {formatDuration(t1)}
                  <span className="text-label3"> · {formatDuration(Math.max(0, t1 - t0))}</span>
                </span>
                {trimChanged && <RevertMark onRevert={() => revert("trim")} label="Schnitt" />}
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-sep px-6 py-3">
        {dirty && hasVideo && (
          <Btn variant="ghost" size="sm" onClick={() => onApplyToAll(draft)}>
            Auf alle anwenden
          </Btn>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Abbrechen
          </Btn>
          <Btn variant="primary" onClick={finish}>
            Fertig
          </Btn>
        </div>
      </footer>
    </Sheet>
  );
}

const round = (t: number) => Math.round(t * 100) / 100;

function cropChangedOf(a?: CropRect, b?: CropRect): boolean {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return a.left !== b.left || a.top !== b.top || a.width !== b.width || a.height !== b.height;
}

/** Welcher Knopf im Verhältnis-Umschalter leuchtet – „Frei", wenn nichts passt. */
function activeRatio(crop: CropRect, rotW: number, rotH: number): string {
  if (crop.width >= rotW - 2 && crop.height >= rotH - 2) return "free";
  const ratio = crop.width / crop.height;
  const hit = RATIOS.find((r) => r.value !== null && Math.abs(ratio - r.value) < 0.02);
  return hit?.id ?? "free";
}

/* ───────────── Zeitleiste ───────────── */

function Track({
  duration,
  now,
  t0,
  t1,
  showTrim,
  onSeek,
  onTrim,
}: {
  duration: number;
  now: number;
  t0: number;
  t1: number;
  showTrim: boolean;
  onSeek: (t: number, phase: "start" | "move" | "end") => void;
  onTrim: (start: number, end: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const trimRef = useRef(onTrim);
  trimRef.current = onTrim;
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;

  /** Was gerade gezogen wird: der Laufkopf oder einer der Schnittgriffe. */
  const [active, setActive] = useState<null | { kind: "scrub" } | { kind: "pull"; side: "start" | "end" }>(null);
  /** Zeit unter dem Zeiger – die Leiste ist sonst ein Lineal ohne Zahlen. */
  const [hover, setHover] = useState<number | null>(null);
  const pct = (t: number) => (duration ? `${Math.max(0, Math.min(100, (t / duration) * 100))}%` : "0%");

  const timeAt = (clientX: number): number | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !duration) return null;
    return round(Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration)));
  };

  useEffect(() => {
    if (!active) return;
    const move = (e: PointerEvent) => {
      const t = timeAt(e.clientX);
      if (t === null) return;
      if (active.kind === "scrub") {
        seekRef.current(t, "move");
        return;
      }
      const clamped = active.side === "start" ? Math.min(t, t1 - 0.1) : Math.max(t, t0 + 0.1);
      if (active.side === "start") trimRef.current(clamped, t1);
      else trimRef.current(t0, clamped);
      seekRef.current(clamped, "move");
    };
    const up = (e: PointerEvent) => {
      const t = timeAt(e.clientX);
      if (t !== null) seekRef.current(t, "end");
      setActive(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [active, duration, t0, t1]);

  /* Beim Ziehen eines Griffs gilt dessen Zeit, sonst die Stelle unter dem Zeiger. */
  const tip = active?.kind === "pull" ? (active.side === "start" ? t0 : t1) : hover;
  const tipPct = duration && tip !== null ? Math.max(6, Math.min(94, (tip / duration) * 100)) : 0;

  return (
    <div
      ref={ref}
      className="relative h-6 flex-1 cursor-pointer touch-none select-none rounded-md bg-fill"
      onPointerDown={(e) => {
        const t = timeAt(e.clientX);
        if (t === null) return;
        seekRef.current(t, "start");
        setActive({ kind: "scrub" });
      }}
      onPointerMove={(e) => {
        if (active) return;
        setHover(timeAt(e.clientX));
      }}
      onPointerLeave={() => setHover(null)}
    >
      {/* Behaltener Bereich */}
      <div
        className={cn("absolute inset-y-0 rounded-md transition-colors", showTrim ? "bg-accent/25" : "bg-accent/15")}
        style={{ left: pct(t0), right: `calc(100% - ${pct(t1)})` }}
      />
      {/* Abgeschnittene Ränder */}
      {showTrim && (
        <>
          <div className="absolute inset-y-0 left-0 rounded-l-md bg-black/15 dark:bg-white/10" style={{ width: pct(t0) }} />
          <div className="absolute inset-y-0 right-0 rounded-r-md bg-black/15 dark:bg-white/10" style={{ width: `calc(100% - ${pct(t1)})` }} />
        </>
      )}
      {/* Laufkopf */}
      <div className="pointer-events-none absolute inset-y-[-3px] w-[2px] rounded-full bg-accent" style={{ left: pct(now) }} />
      {/* Griffe */}
      {showTrim &&
        (["start", "end"] as const).map((side) => (
          <span
            key={side}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              seekRef.current(side === "start" ? t0 : t1, "start");
              setActive({ kind: "pull", side });
            }}
            className="absolute top-1/2 h-5 w-[9px] -ml-[4.5px] -translate-y-1/2 cursor-ew-resize rounded-[3px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-1 ring-black/10"
            style={{ left: pct(side === "start" ? t0 : t1) }}
          >
            <span className="absolute left-1/2 top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-black/25" />
          </span>
        ))}
      {/* Zeit am Zeiger */}
      {tip !== null && duration > 0 && (
        <span
          className="anim-fade tnum pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded-[6px] bg-fill2 px-1.5 py-[2px] text-[11px] font-medium text-label shadow-[0_2px_6px_rgba(0,0,0,0.22)]"
          style={{ left: `${tipPct}%` }}
        >
          {formatDuration(tip)}
        </span>
      )}
    </div>
  );
}

import { Check, Play, RotateCw, X } from "lucide-react";
import type { ReactNode } from "react";
import { adjustmentsSummary, estimateOutputBytes } from "../lib/job";
import { extOf, formatBytes, formatDuration, resolutionLabel } from "../lib/format";
import { sourceCodecLabel } from "../lib/formats";
import type { Item, Preset } from "../lib/types";
import { cn } from "../utils/cn";

function Ring({ value }: { value: number }) {
  const r = 8.5;
  const c = 2 * Math.PI * r;
  const pct = Math.round(value * 100);
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      className="-rotate-90"
      role="progressbar"
      aria-label={`${pct} %`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <circle cx="11" cy="11" r={r} fill="none" strokeWidth="2.4" className="stroke-fill2" />
      <circle
        cx="11"
        cy="11"
        r={r}
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="stroke-accent transition-[stroke-dashoffset] duration-300 ease-out"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.03, Math.min(1, value)))}
      />
    </svg>
  );
}

function details(item: Item): string {
  const i = item.info;
  if (!i) return "";
  const parts: string[] = [];
  if (item.source.relDirs.length) parts.push(item.source.relDirs.join(" › "));
  parts.push(extOf(item.source.name).toUpperCase());
  if (i.video) parts.push(`${resolutionLabel(i.video.width, i.video.height)} ${sourceCodecLabel(i.video.codec)}`);
  else if (i.audio) parts.push(sourceCodecLabel(i.audio.codec));
  if (i.duration) parts.push(formatDuration(i.duration));
  return parts.filter(Boolean).join(" · ");
}

function Glyph({ audio }: { audio: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-label2" aria-hidden>
      {audio ? (
        <path d="M9.2 17.4V6.6l9.3-2.1v10.9M9.2 17.4a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0Zm9.3-2a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      ) : (
        <>
          <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10.4 9.1v5.8l4.9-2.9z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function FileRow({
  item,
  preset,
  locked = false,
  onRemove,
  onRetry,
  onOpen,
  selected = false,
  onToggleSelect,
  onClearSelection,
}: {
  item: Item;
  preset: Preset;
  locked?: boolean;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  /** Doppelklick auf die Zeile: abspielen, drehen, zuschneiden, schneiden. */
  onOpen?: (id: string) => void;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onClearSelection?: () => void;
}) {
  const { status, info } = item;
  const removable = !locked && status !== "converting" && status !== "queued";
  const estimate = info && status === "ready" ? estimateOutputBytes(preset, info, item.adjustments) : 0;
  const adjusted = adjustmentsSummary(item.adjustments);
  const canOpen = !!onOpen && !!info && !locked;
  const isAudio = !!info && !info.video;
  const dim = status === "queued" || status === "checking";

  let secondary: ReactNode = null;
  let tone = "text-label2";
  if (status === "checking") secondary = <span className="anim-breathe">Wird geprüft …</span>;
  else if (status === "done") {
    const bits = [item.outSize ? formatBytes(item.outSize) : "", item.outPlace ?? ""].filter(Boolean);
    secondary = item.message ? (item.repaired ? `Repariert – ${item.message}` : item.message) : bits.join(" · ") || "Fertig";
    if (item.message) tone = "text-warn";
  } else if (status === "failed") {
    secondary = item.message;
    tone = "text-bad";
  } else if (status === "ready" && item.health.state === "repair") {
    secondary = item.health.note;
    tone = "text-warn";
  } else secondary = details(item);

  return (
    <li
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          onToggleSelect?.(item.id);
          return;
        }
        onClearSelection?.();
      }}
      onDoubleClick={canOpen ? () => onOpen!(item.id) : undefined}
      title={canOpen ? "Doppelklick: bearbeiten · ⌘/Strg-Klick: auswählen" : undefined}
      className={cn(
        "anim-row group relative flex min-h-[64px] items-center gap-3.5 px-4 py-2.5 transition-[opacity,background-color] duration-300",
        canOpen && "cursor-default",
        selected && "bg-accent/[0.07]",
        dim && "opacity-60",
        "[&+&]:before:absolute [&+&]:before:left-[86px] [&+&]:before:right-0 [&+&]:before:top-0 [&+&]:before:h-px [&+&]:before:bg-sep"
      )}
    >
      {selected && (
        <span className="anim-fade absolute left-3 top-2 z-10 grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            onToggleSelect?.(item.id);
            return;
          }
          if (canOpen) onOpen!(item.id);
        }}
        disabled={!canOpen}
        aria-label={canOpen ? `${item.source.name} abspielen und bearbeiten` : item.source.name}
        className="group/thumb relative grid h-[42px] w-[56px] shrink-0 place-items-center overflow-hidden rounded-[9px] bg-fill transition-[filter,transform] duration-200 hover:brightness-[0.92] active:scale-95 disabled:pointer-events-none"
      >
        {item.thumb ? (
          <img src={item.thumb} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <Glyph audio={isAudio} />
        )}
        {status === "done" ? (
          <span className="anim-fade absolute inset-0 grid place-items-center bg-black/40">
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-ok">
              <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
            </span>
          </span>
        ) : (
          canOpen && (
            <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover/thumb:opacity-100">
              <Play className="ml-[1px] h-4 w-4 text-white" fill="currentColor" strokeWidth={0} />
            </span>
          )
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium leading-tight" title={item.source.name}>
          {item.source.name}
        </div>
        <div className={cn("mt-[3px] line-clamp-2 text-[12px] leading-snug", tone)}>{secondary}</div>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1.5">
        {adjusted && (
          <span className="rounded-full bg-accent/10 px-2 py-[3px] text-[11px] font-medium text-accent transition-opacity group-hover:opacity-0">
            {adjusted}
          </span>
        )}
        {status === "ready" && estimate > 0 && (
          <span className="tnum text-[12.5px] text-label2 transition-opacity group-hover:opacity-0">{formatBytes(estimate)}</span>
        )}
        {status === "converting" && <Ring value={item.progress} />}
        {status === "failed" && !item.final && !locked && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry(item.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label="Erneut versuchen"
            className="grid h-7 w-7 place-items-center rounded-full text-accent transition hover:bg-accent/10 active:scale-90"
          >
            <RotateCw className="h-[15px] w-[15px]" />
          </button>
        )}
      </div>

      {removable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(item.id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label={`${item.source.name} entfernen`}
          className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-fill text-label2 opacity-0 transition hover:bg-fill2 hover:text-label focus-visible:opacity-100 active:scale-90 group-hover:opacity-100"
          style={status === "failed" && !item.final ? { right: 48 } : undefined}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.4} />
        </button>
      )}
    </li>
  );
}

import { AlertTriangle, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Overall } from "../hooks/useApp";
import { formatBytes, formatDuration, formatRemaining, plural } from "../lib/format";
import { fsaSupported } from "../lib/fsa";
import { estimateOutputBytes } from "../lib/job";
import type { Item, Preset, Settings } from "../lib/types";
import { Btn, Menu, MenuItem } from "./ui";

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" aria-hidden>
      <path
        d="M3.5 7.4c0-1.1.9-2 2-2h3.7l2 2h7.3c1.1 0 2 .9 2 2v7.8c0 1.1-.9 2-2 2h-13c-1.1 0-2-.9-2-2z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}

export function Footer({
  items,
  preset,
  settings,
  running,
  planning,
  overall,
  notice,
  onStart,
  onStop,
  onRetryFailed,
  onClear,
  onChooseDestination,
  onUseAuto,
  onUseCustom,
  onDismissNotice,
  selected,
  onClearSelection,
}: {
  items: Item[];
  preset: Preset;
  settings: Settings;
  running: boolean;
  planning: boolean;
  overall: Overall | null;
  notice: string | null;
  onStart: () => void;
  onStop: () => void;
  /** Alle Fehler, die ein zweiter Versuch beheben kann, erneut in die Warteschlange. */
  onRetryFailed: () => void;
  onClear: () => void;
  onChooseDestination: () => void;
  onUseAuto: () => void;
  onUseCustom: () => void;
  onDismissNotice: () => void;
  /** Leer heißt: der Lauf gilt allen. Sonst nur den markierten Dateien. */
  selected: string[];
  onClearSelection: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmStop) return;
    const t = setTimeout(() => setConfirmStop(false), 3000);
    return () => clearTimeout(t);
  }, [confirmStop]);
  useEffect(() => {
    if (!running) setConfirmStop(false);
  }, [running]);

  const ready = items.filter((i) => i.status === "ready" && i.info);
  /* Eine Auswahl schränkt den Lauf ein – und damit jede Zahl, die ihn beschreibt. */
  const scope = selected.length ? ready.filter((i) => selected.includes(i.id)) : ready;
  const checking = items.some((i) => i.status === "checking");
  const doneCount = items.filter((i) => i.status === "done").length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const finished = !running && items.some((i) => i.attempted) && ready.length === 0 && !checking;
  const retryable = items.filter((i) => i.status === "failed" && !i.final).length;
  const readyDuration = scope.reduce((s, i) => s + (i.info?.duration ?? 0), 0);
  const readyBytes = scope.reduce((s, i) => s + (i.info ? estimateOutputBytes(preset, i.info, i.adjustments) : 0), 0);

  const custom = settings.destination === "custom" && !!settings.customDestinationName;
  const anyFolderSource = items.some((i) => i.source.root);
  const autoLabel = anyFolderSource ? "Neben den Originalen" : "Downloads";
  const label = !fsaSupported ? "Downloads" : custom ? settings.customDestinationName : autoLabel;

  let status: ReactNode = null;
  if (notice) {
    status = (
      <div className="anim-fade flex min-w-0 items-center gap-2 text-[13px] text-warn" role="alert">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="truncate">{notice}</span>
        <button
          onClick={onDismissNotice}
          aria-label="Schließen"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-label2 hover:bg-fill"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  } else if (running && overall) {
    const fraction = overall.fraction;
    status = (
      <div className="anim-fade" role="status">
        <div className="tnum mb-[7px] flex justify-between text-[12px] text-label2">
          <span>
            {Math.min(overall.completed + 1, overall.total)} von {overall.total}
          </span>
          <span>{overall.eta ? formatRemaining(overall.eta) : "\u00a0"}</span>
        </div>
        <div
          className="h-[5px] overflow-hidden rounded-full bg-fill2"
          role="progressbar"
          aria-label="Gesamtfortschritt"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(1.5, fraction * 100)}%` }}
          />
        </div>
      </div>
    );
  } else if (finished) {
    status = (
      <div className="anim-fade truncate text-[13px] font-medium">
        {doneCount > 0 ? `${plural(doneCount, "Datei", "Dateien")} fertig` : "Nichts konvertiert"}
        {failedCount > 0 && <span className="font-normal text-label2"> · {failedCount} nicht möglich</span>}
      </div>
    );
  } else if (checking) {
    status = <div className="anim-breathe text-[13px] text-label2">Wird geprüft …</div>;
  } else if (ready.length) {
    status = (
      <div className="tnum truncate text-[13px] text-label2">
        {selected.length ? `${scope.length} von ${ready.length} ausgewählt` : plural(ready.length, "Datei", "Dateien")}
        {readyDuration > 0 && ` · ${formatDuration(readyDuration)}`}
        {readyBytes > 0 && ` · ca. ${formatBytes(readyBytes)}`}
      </div>
    );
  }

  return (
    <footer className="glass relative z-20 border-t border-sep">
      <div className="mx-auto flex h-[72px] w-full max-w-[880px] items-center gap-4 px-4 sm:px-8">
        <div className="relative shrink-0">
          <button
            ref={anchorRef}
            onClick={() => setOpen((o) => !o)}
            disabled={running || planning || !fsaSupported}
            className="flex h-9 items-center gap-2 rounded-full pl-2.5 pr-2 text-[13px] font-medium transition hover:bg-fill active:scale-[0.97] disabled:hover:bg-transparent"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Ziel: ${label}`}
          >
            <FolderGlyph />
            <span className="max-w-[180px] truncate">{label}</span>
            {fsaSupported && !running && (
              <ChevronDown className={`h-3.5 w-3.5 text-label2 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
            )}
          </button>
          <Menu open={open} onClose={() => setOpen(false)} anchor={anchorRef.current} placement="top" align="start">
              <MenuItem
                selected={!custom}
                title="Neben den Originalen"
                sub={`Ordner „${settings.outFolderName || "Konvertiert"}“`}
                onClick={() => {
                  onUseAuto();
                  setOpen(false);
                }}
              />
              {settings.customDestinationName && (
                <MenuItem
                  selected={custom}
                  title={settings.customDestinationName}
                  onClick={() => {
                    onUseCustom();
                    setOpen(false);
                  }}
                />
              )}
              <div className="mx-2.5 my-1 h-px bg-sep" />
              <MenuItem
                title="Anderer Ordner …"
                onClick={() => {
                  onChooseDestination();
                  setOpen(false);
                }}
              />
          </Menu>
        </div>

        <div className="min-w-0 flex-1">{status}</div>

        {running ? (
          confirmStop ? (
            <Btn
              size="lg"
              variant="primary"
              className="!bg-bad"
              onClick={() => {
                setConfirmStop(false);
                onStop();
              }}
            >
              Wirklich stoppen
            </Btn>
          ) : (
            <Btn size="lg" onClick={() => setConfirmStop(true)}>
              Stoppen
            </Btn>
          )
        ) : finished ? (
          <>
            {retryable > 0 && (
              <Btn variant="ghost" onClick={onClear}>
                Alle entfernen
              </Btn>
            )}
            <Btn variant="primary" size="lg" onClick={retryable > 0 ? onRetryFailed : onClear}>
              {retryable > 0 ? "Erneut versuchen" : "Fertig"}
            </Btn>
          </>
        ) : (
          <>
            {selected.length > 0 && (
              <Btn variant="ghost" onClick={onClearSelection}>
                Auswahl aufheben
              </Btn>
            )}
            <Btn variant="primary" size="lg" onClick={onStart} disabled={!scope.length || checking || planning}>
              {selected.length ? "Auswahl konvertieren" : "Konvertieren"}
            </Btn>
          </>
        )}
      </div>
    </footer>
  );
}

import { Minus, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FileInspector } from "./components/FileInspector";
import { Footer } from "./components/Footer";
import { PresetBar } from "./components/PresetBar";
import { PresetGrid } from "./components/PresetGrid";
import { PresetEditor } from "./components/PresetEditor";
import { GearGlyph } from "./components/PresetIcon";
import { SettingsSheet } from "./components/SettingsSheet";
import { Stage } from "./components/Stage";
import { useApp } from "./hooks/useApp";
import { webPresetIssue } from "./lib/compatibility";
import { plural } from "./lib/format";
import { sameMetadata } from "./lib/metadata";
import { cloneAsNew, clonePreset } from "./lib/presets";
import type { Preset } from "./lib/types";

/** Warum ein Bedienelement gerade nicht geht. Gesperrt heißt: mit Begründung. */
const LOCK_HINT = "Während der Konvertierung gesperrt";

export default function App() {
  const app = useApp();
  const { items, running } = app;
  const busy = app.locked;
  /** Geöffneter Preset-Editor: ein Entwurf und die ID des gespeicherten Presets (null = neu). */
  const [editor, setEditor] = useState<{ original: Preset; savedId: string | null } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  /** Das Fenster mit allen Presets – immer erreichbar, nicht erst bei vielen. */
  const [showGrid, setShowGrid] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Geöffnete Datei – Drehen, Zuschneiden, Schneiden. */
  const [inspecting, setInspecting] = useState<string | null>(null);
  const inspected = inspecting ? items.find((i) => i.id === inspecting) : undefined;
  /** Solange noch eine Datei gelesen wird, ist nichts anderes dran. */
  const loadingCount = items.filter((i) => i.status === "checking").length;

  const addDropRef = useRef(app.addDrop);
  addDropRef.current = app.addDrop;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  /* Erscheinungsbild: System, Hell oder Dunkel – wie in den Einstellungen gewählt. */
  const appearance = app.settings.appearance;
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        appearance === "dark" || (appearance === "auto" && mq.matches)
      );
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [appearance]);

  /* Fortschritt im Fenstertitel – sichtbar, auch wenn das Fenster im Hintergrund ist. */
  useEffect(() => {
    if (running && app.overall) document.title = `${Math.round(app.overall.fraction * 100)} % – Wandler`;
    else document.title = "Wandler";
    window.wandler?.progress(running && app.overall ? app.overall.fraction : -1);
  }, [running, app.overall]);

  /* Ablegen überall im Fenster */
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (!busyRef.current) setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = busyRef.current ? "none" : "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer && !busyRef.current) void addDropRef.current(e.dataTransfer);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  /* Tastatur: ⌘O öffnen · ⌘↩ konvertieren · ⌘, Einstellungen · Esc stoppt nie versehentlich */
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement);
      /* Esc räumt die Auswahl weg – solange kein Fenster offen ist, dem es gehört. */
      if (e.key === "Escape" && !editor && !showSettings && !inspecting && !showGrid && app.selected.length) {
        app.clearSelection();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || typing || editor || showSettings || inspecting || showGrid) return;
      const k = e.key.toLowerCase();
      if (k === "a") {
        e.preventDefault();
        if (!busy) app.selectAll();
      } else if (k === "o") {
        e.preventDefault();
        if (!busy) void (e.shiftKey ? app.addFolder() : app.addFiles());
      } else if (k === "enter") {
        e.preventDefault();
        if (!busy) void app.start();
      } else if (k === ",") {
        e.preventDefault();
        if (!busy) setShowSettings(true);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [app, busy, editor, showSettings, inspecting, showGrid]);

  /* Läuft die Konvertierung los, schließt sich das Fenster von allein. */
  useEffect(() => {
    if (busy) setInspecting(null);
  }, [busy]);

  const openInspector = (id: string) => {
    if (busy) return;
    const found = items.find((i) => i.id === id);
    if (!found || !found.info) return;
    setInspecting(id);
  };

  const openEditor = (id: string) => {
    const found = app.presets.find((p) => p.id === id);
    if (!found) return;
    app.selectPreset(id);
    setEditor({ original: clonePreset(found), savedId: id });
  };

  return (
    <div className="app-shell flex h-full flex-col bg-canvas">
      <header className="drag relative z-10 grid h-[46px] shrink-0 grid-cols-[1fr_auto_1fr] items-center px-3">
        <div className="no-drag flex gap-1">
          {window.wandler && ([ ["close", "Schließen", X], ["minimize", "Minimieren", Minus], ["maximize", "Fenstergröße ändern", Square] ] as const).map(([action, label, Icon]) => (
            <button key={action} aria-label={label} title={label} onClick={() => window.wandler?.window(action)} className="window-control grid h-7 w-7 place-items-center rounded-full text-label2 hover:bg-fill2 active:scale-95">
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <span className="text-[13px] font-semibold text-label2">Wandler</span>
        <div className="no-drag flex justify-end">
          <button
            aria-label="Einstellungen"
            disabled={busy}
            title={busy ? LOCK_HINT : "Einstellungen"}
            onClick={() => setShowSettings(true)}
            className="grid h-8 w-8 place-items-center rounded-full text-label2/80 transition hover:bg-fill hover:text-label active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <GearGlyph className="h-[17px] w-[17px]" />
          </button>
        </div>
      </header>

      <main inert={app.collecting || loadingCount > 0} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-4 pb-8 sm:px-8">
          <PresetBar
            presets={app.presets}
            selectedId={app.preset.id}
            disabled={busy}
            lockReason={LOCK_HINT}
            canDelete={app.presets.length > 1}
            onSelect={app.selectPreset}
            onEdit={openEditor}
            onDuplicate={app.duplicatePreset}
            onDelete={app.deletePreset}
            onReorder={app.movePreset}
            onAdd={() => setEditor({ original: cloneAsNew(app.preset, "Neues Preset"), savedId: null })}
            onOpenGrid={() => setShowGrid(true)}
          />
          {!window.wandler && webPresetIssue(app.preset) && (
            <p className="mb-4 rounded-xl bg-fill px-4 py-3 text-[12px] leading-relaxed text-label2" role="note">
              {webPresetIssue(app.preset)}
            </p>
          )}
          <Stage
            items={items}
            preset={app.preset}
            outFolderName={app.settings.outFolderName}
            dragging={dragging}
            running={busy}
            onAddFiles={() => void app.addFiles()}
            onAddFolder={() => void app.addFolder()}
            onRemove={app.remove}
            onRetry={app.retry}
            onClear={app.clear}
            onOpen={busy ? undefined : openInspector}
            selected={app.selected}
            onToggleSelect={app.toggleSelect}
            onClearSelection={app.clearSelection}
          />
        </div>
      </main>

      {!items.length && app.notice && <p role="alert" className="mx-6 mb-4 rounded-xl bg-fill px-4 py-3 text-sm text-warn">{app.notice}</p>}

      {items.length > 0 && (
        <Footer
          items={items}
          preset={app.preset}
          settings={app.settings}
          running={running}
          planning={app.planning}
          overall={app.overall}
          notice={app.notice}
          onStart={() => void app.start()}
          onStop={app.stop}
          onRetryFailed={app.retryFailed}
          onClear={app.clear}
          onChooseDestination={() => void app.chooseDestination()}
          onUseAuto={() => app.updateSettings({ destination: "auto" })}
          onUseCustom={app.useCustomDestination}
          onDismissNotice={app.dismissNotice}
          selected={app.selected}
          onClearSelection={app.clearSelection}
          fsSupported={app.fsSupported}
        />
      )}

      {showGrid && (
        <PresetGrid
          presets={app.presets}
          selectedId={app.preset.id}
          disabled={busy}
          lockReason={LOCK_HINT}
          canDelete={app.presets.length > 1}
          onSelect={app.selectPreset}
          onEdit={openEditor}
          onDuplicate={app.duplicatePreset}
          onDelete={app.deletePreset}
          onAdd={() => {
            setShowGrid(false);
            setEditor({ original: cloneAsNew(app.preset, "Neues Preset"), savedId: null });
          }}
          onClose={() => setShowGrid(false)}
        />
      )}

      {editor && (
        <PresetEditor
          key={editor.original.id}
          preset={editor.original}
          isNew={editor.savedId === null}
          caps={app.caps}
          hardware={app.hardware}
          hwOn={app.settings.hardware === "auto"}
          onFinish={(p) => {
            if (editor.savedId) app.savePreset(p);
            else app.createPreset(p);
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}

      {inspected?.info && (
        <FileInspector
          key={inspected.id}
          item={inspected}
          preset={app.preset}
          caps={app.caps}
          tmdbKey={app.settings.tmdbKey}
          tmdbLanguage={app.settings.tmdbLanguage}
          onClose={() => setInspecting(null)}
          onFinish={(adj, metadata) => {
            app.setAdjustments(inspected.id, adj);
            /* Nur schreiben, wenn sich wirklich etwas geändert hat. */
            if (!sameMetadata(metadata, inspected.metadata)) app.setMetadata(inspected.id, metadata);
            setInspecting(null);
          }}
          onApplyToAll={(adj) => {
            app.applyAdjustmentsToAll(adj);
            setInspecting(null);
          }}
          onApplyMetadataToAll={(metadata) => {
            app.applySeriesToAll(metadata);
            setInspecting(null);
          }}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      {showSettings && (
        <SettingsSheet
          settings={app.settings}
          hardware={app.hardware}
          onChange={app.updateSettings}
          onClose={() => setShowSettings(false)}
          onForgetFolders={() => void app.forgetDestinations()}
        />
      )}

      {(app.collecting || loadingCount > 0) && (
        <div
          className="anim-fade fixed inset-0 z-[80] grid place-items-center bg-canvas/55 backdrop-blur-[6px]"
          role="dialog"
          aria-modal="true"
          aria-label="Dateien werden gelesen"
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Tab" || e.key === "Escape") e.preventDefault(); }}
          aria-busy="true"
        >
          <div className="anim-sheet flex items-center gap-3.5 rounded-[16px] bg-surface px-5 py-4 shadow-pop">
            <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-sep border-t-accent" />
            <div>
              <div className="text-[14px] font-medium">{loadingCount ? `${plural(loadingCount, "Datei wird", "Dateien werden")} gelesen` : "Dateien werden eingelesen …"}</div>
              <div className="mt-[2px] text-[12px] text-label2">Dateien analysieren und Vorschauen vorbereiten …</div>
            </div>
          </div>
        </div>
      )}

      {dragging && items.length > 0 && (
        <div
          className="anim-fade pointer-events-none fixed inset-0 z-40 grid place-items-center bg-canvas/60 backdrop-blur-[6px]"
          aria-hidden="true"
        >
          <p className="text-[22px] font-semibold tracking-tight">Loslassen</p>
        </div>
      )}
    </div>
  );
}

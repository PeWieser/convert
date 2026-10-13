import { useEffect, useRef, useState } from "react";
import { Footer } from "./components/Footer";
import { PresetBar } from "./components/PresetBar";
import { PresetEditor } from "./components/PresetEditor";
import { GearGlyph } from "./components/PresetIcon";
import { SettingsSheet } from "./components/SettingsSheet";
import { Stage } from "./components/Stage";
import { useApp } from "./hooks/useApp";
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
  const [dragging, setDragging] = useState(false);

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
      if (!(e.metaKey || e.ctrlKey) || typing || editor || showSettings) return;
      const k = e.key.toLowerCase();
      if (k === "o") {
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
  }, [app, busy, editor, showSettings]);

  const openEditor = (id: string) => {
    const found = app.presets.find((p) => p.id === id);
    if (!found) return;
    app.selectPreset(id);
    setEditor({ original: clonePreset(found), savedId: id });
  };

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="drag relative z-10 grid h-[46px] shrink-0 grid-cols-[1fr_auto_1fr] items-center px-3">
        <span />
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

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-4 pb-8 sm:px-8">
          <PresetBar
            presets={app.presets}
            selectedId={app.preset.id}
            disabled={busy}
            lockReason={LOCK_HINT}
            onSelect={app.selectPreset}
            onEdit={openEditor}
            onAdd={() => setEditor({ original: cloneAsNew(app.preset, "Neues Preset"), savedId: null })}
          />
          <Stage
            items={items}
            preset={app.preset}
            dragging={dragging}
            running={busy}
            onAddFiles={() => void app.addFiles()}
            onAddFolder={() => void app.addFolder()}
            onRemove={app.remove}
            onRetry={app.retry}
            onClear={app.clear}
          />
        </div>
      </main>

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
          canDelete={editor.savedId !== null && app.presets.length > 1}
          onSave={(p) => {
            if (editor.savedId) app.savePreset(p);
            else app.createPreset(p);
            setEditor(null);
          }}
          onDuplicate={(current) => setEditor({ original: cloneAsNew(current), savedId: null })}
          onDelete={() => {
            if (editor.savedId) app.deletePreset(editor.savedId);
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}

      {showSettings && (
        <SettingsSheet
          settings={app.settings}
          hardware={app.hardware}
          onChange={app.updateSettings}
          onClose={() => setShowSettings(false)}
          onForgetFolders={() => void app.forgetDestinations()}
          onResetPresets={app.resetAllPresets}
        />
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConvertError, webEngine } from "../lib/engine";
import { uniqueSources } from "../lib/sources";
import { nativePlatform } from "../lib/native";
import { webPresetIssue } from "../lib/compatibility";
import { plural } from "../lib/format";
import { CONTAINERS } from "../lib/formats";
import { webFS } from "../lib/fsa";
import type { MediaEngine, PlatformFS, Target } from "../lib/platform";

/** Die Naht, an der die Desktop-App später eine andere Implementierung einsetzt. */
const native = nativePlatform();
const fs: PlatformFS = native?.fs ?? webFS;
const engine: MediaEngine = native?.engine ?? webEngine;
import { detectHardware } from "../lib/hardware";
import { NO_ADJUSTMENTS } from "../lib/job";
import { moveTo } from "../lib/order";
import { BASE_AUDIO, BASE_VIDEO, cloneAsNew, defaultPresets, normalizePreset } from "../lib/presets";
import { createLimiter } from "../lib/queue";
import { DEFAULT_SETTINGS, usePersistent } from "../lib/storage";
import type { Adjustments, Capabilities, HardwareInfo, Item, Preset, Settings, SourceFile } from "../lib/types";

/** Wird diese Datei durch eine Einstellungsänderung erneut fällig? */
const willRearm = (i: Item) =>
  (i.status === "done" || (i.status === "failed" && i.health.state !== "broken")) && !!i.info;


export interface Overall {
  fraction: number;
  completed: number;
  total: number;
  eta?: number;
}

export function useApp() {
  const [presets, setPresets] = usePersistent<Preset[]>("wandler.presets.v1", defaultPresets, (stored) =>
    Array.isArray(stored) && stored.length
      ? stored.map((p) => normalizePreset({ ...p, video: { ...BASE_VIDEO, ...p.video }, audio: { ...BASE_AUDIO, ...p.audio } }))
      : defaultPresets()
  );
  const [settings, setSettings] = usePersistent<Settings>(
    "wandler.settings.v1",
    () => DEFAULT_SETTINGS,
    // `concurrency` war in früheren Versionen unbenutzt und stand auf 1;
    // gemeint war „automatisch", das ist heute die 0.
    (s) => ({ ...DEFAULT_SETTINGS, ...s, concurrency: Math.max(0, Math.min(8, s.concurrency ?? 0)) })
  );
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const importBusy = useRef(false);
  const [planning, setPlanning] = useState(false);
  const [overall, setOverall] = useState<Overall | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Ausgewählte Dateien. Ist die Liste leer, gilt der Lauf allen – Auswahl ist
   * eine bewusste Einschränkung, kein dauerhafter Modus.
   */
  const [selected, setSelected] = useState<string[]>([]);
  const [caps, setCaps] = useState<Capabilities>({ video: [], audio: [], ready: false, subtitles: false });
  /*
   * Der erste Blick kommt aus WebGL, damit das Fenster nicht leer steht. Die
   * Auskunft, auf die sich die App verlässt, liefert die Engine: im Web gefiltert
   * durch das, was der Browser encodieren kann, auf dem Desktop aus
   * `ffmpeg -encoders` (Befund P2-10).
   */
  const [hardware, setHardware] = useState<HardwareInfo>(() => detectHardware());
  useEffect(() => {
    engine.hardware?.().then(setHardware).catch(() => undefined);
  }, []);

  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const presetsRef = useRef<Preset[]>([]);
  presetsRef.current = presets;
  const abortRef = useRef<AbortController | null>(null);
  const probeLimit = useRef(createLimiter(2)).current;

  /**
   * Die Engine lädt einzelne Bausteine nach. Fällt dabei etwas aus – meist keine
   * Verbindung – sagt die App es, statt später still Dateien zu verwerfen. Und
   * sie versucht es erneut, sobald das Netz zurück ist.
   */
  const loadEngine = useCallback(() => {
    engine
      .init()
      .then(setCaps)
      .catch((e) => {
        setCaps({ video: [], audio: [], ready: false, subtitles: false });
        setNotice(e instanceof Error ? e.message : "Die Konvertierungs-Engine konnte nicht gestartet werden.");
      });
  }, []);
  useEffect(() => {
    loadEngine();
    window.addEventListener("online", loadEngine);
    return () => window.removeEventListener("online", loadEngine);
  }, [loadEngine]);
  useEffect(() => {
    if (caps.missing?.length)
      setNotice(
        `Die Bausteine für ${caps.missing.join(" und ")} sind nicht geladen – vermutlich fehlt die Verbindung. Diese Formate gehen gerade nicht.`
      );
  }, [caps.missing]);

  const preset = useMemo(
    () => presets.find((p) => p.id === settings.selectedPresetId) ?? presets[0],
    [presets, settings.selectedPresetId]
  );

  useEffect(() => {
    if (!presets.some((p) => p.id === settings.selectedPresetId) && presets[0]) {
      setSettings((s) => ({ ...s, selectedPresetId: presets[0].id }));
    }
  }, [presets, settings.selectedPresetId, setSettings]);

  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  /* ───────── Einstellungen & Presets ───────── */

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [setSettings]
  );

  /** Nach einem Durchlauf: neues Ziel-Format → Dateien sind wieder startbereit. */
  const rearm = useCallback(() => {
    const attempted = itemsRef.current.some((i) => i.attempted);
    const affected = attempted ? itemsRef.current.filter(willRearm).length : 0;
    setItems((prev) =>
      prev.some((i) => i.attempted)
        ? prev.map((i) =>
            willRearm(i)
              ? { ...i, status: "ready" as const, progress: 0, message: undefined, outSize: undefined, outPlace: undefined, repaired: false, final: false, attempted: false }
              : { ...i, attempted: false }
          )
        : prev
    );
    return affected;
  }, []);

  const selectPreset = useCallback(
    (id: string) => {
      if (id !== settings.selectedPresetId) {
        const affected = rearm();
        if (affected > 0)
          setNotice(
            `${plural(affected, "fertige Datei wird", "fertige Dateien werden")} mit dem neu gewählten Preset erneut konvertiert.`
          );
      }
      updateSettings({ selectedPresetId: id });
    },
    [updateSettings, rearm, settings.selectedPresetId]
  );

  /**
   * Nimmt den Entwurf aus dem Preset-Editor entgegen. Erst dieser Aufruf schreibt
   * dauerhaft – und erst hier werden fertige Dateien wieder startbereit, angekündigt.
   */
  const savePreset = useCallback(
    (p: Preset) => {
      const next = normalizePreset(p);
      const before = presetsRef.current.find((x) => x.id === next.id);
      if (before && JSON.stringify(before) === JSON.stringify(next)) return;
      setPresets((prev) => prev.map((x) => (x.id === next.id ? next : x)));
      const affected = rearm();
      if (affected > 0)
        setNotice(
          `${plural(affected, "fertige Datei wird", "fertige Dateien werden")} mit den neuen Einstellungen erneut konvertiert.`
        );
    },
    [setPresets, rearm]
  );

  /** Ein neues Preset entsteht erst beim Speichern – nicht schon beim Öffnen des Editors. */
  const createPreset = useCallback(
    (p: Preset) => {
      const np = normalizePreset(p);
      delete np.builtin;
      setPresets((prev) => [...prev, np]);
      updateSettings({ selectedPresetId: np.id });
      return np.id;
    },
    [setPresets, updateSettings]
  );

  /** Duplizieren legt die Kopie sofort an – sie erscheint als neue Karte, bereit zum Bearbeiten. */
  const duplicatePreset = useCallback(
    (id: string) => {
      const base = presetsRef.current.find((p) => p.id === id);
      if (!base) return;
      const copy = cloneAsNew(base);
      setPresets((prev) => {
        const at = prev.findIndex((p) => p.id === id);
        const next = [...prev];
        next.splice(at + 1, 0, copy);
        return next;
      });
      updateSettings({ selectedPresetId: copy.id });
    },
    [setPresets, updateSettings]
  );

  const deletePreset = useCallback(
    (id: string) => {
      if (presets.length <= 1) return;
      const rest = presets.filter((p) => p.id !== id);
      setPresets(rest);
      if (settings.selectedPresetId === id) updateSettings({ selectedPresetId: rest[0].id });
    },
    [presets, setPresets, settings.selectedPresetId, updateSettings]
  );

  /**
   * Verschiebt ein Preset an eine neue Stelle.
   * `toIndex` zählt ohne das verschobene Preset – so gibt die Oberfläche die
   * Stelle genauso an, wie sie sie meint.
   */
  const movePreset = useCallback(
    (id: string, toIndex: number) => {
      setPresets((prev) => {
        const from = prev.findIndex((p) => p.id === id);
        if (from < 0) return prev;
        return moveTo(prev, from, toIndex);
      });
    },
    [setPresets]
  );

  /* ───────── Dateien ───────── */

  const patch = useCallback((id: string, p: Partial<Item>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, []);

  const addSources = useCallback(
    async (sources: SourceFile[]) => {
      if (!sources.length) return;
      const accepted = await uniqueSources(itemsRef.current.map((i) => i.source), sources);
      if (!accepted.length) return;
      const fresh: Item[] = accepted.map((s) => ({
        id: s.id,
        source: s,
        status: "checking",
        health: { state: "ok" },
        progress: 0,
        adjustments: NO_ADJUSTMENTS,
      }));
      setItems((prev) => [...prev, ...fresh]);

      for (const s of accepted) {
        probeLimit(async () => {
          let r: Awaited<ReturnType<typeof engine.probe>>;
          try {
            r = await engine.probe(s);
          } catch {
            r = { health: { state: "broken", reason: "Die Datei konnte nicht gelesen werden." } };
          }
          setItems((prev) => {
            if (!prev.some((i) => i.id === s.id)) {
              if (r.thumb) URL.revokeObjectURL(r.thumb);
              return prev;
            }
            return prev.map((i) => {
              if (i.id !== s.id) return i;
              if (r.health.state === "broken")
                return { ...i, status: "failed", health: r.health, message: r.health.reason, final: true, info: r.info, thumb: r.thumb };
              return { ...i, status: "ready", health: r.health, info: r.info, thumb: r.thumb };
            });
          });
        }).catch(() => undefined);
      }
    },
    [probeLimit]
  );

  const collect = useCallback(async (pick: () => Promise<SourceFile[]>) => {
    if (importBusy.current) return;
    importBusy.current = true;
    setCollecting(true);
    try { await addSources(await pick()); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Die Dateien konnten nicht gelesen werden."); }
    finally { importBusy.current = false; setCollecting(false); }
  }, [addSources]);
  const addFiles = useCallback(() => collect(() => fs.pickFiles()), [collect]);
  const addFolder = useCallback(() => collect(() => fs.pickFolder(settings.outFolderName)), [collect, settings.outFolderName]);
  const addDrop = useCallback((dt: DataTransfer) => collect(() => fs.collectFromDrop(dt, settings.outFolderName)), [collect, settings.outFolderName]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const selectAll = useCallback(() => {
    setSelected(itemsRef.current.filter((i) => i.status === "ready" && i.info).map((i) => i.id));
  }, []);

  const clearSelection = useCallback(() => setSelected([]), []);

  const remove = useCallback((id: string) => {
    setSelected((prev) => prev.filter((x) => x !== id));
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone?.thumb) URL.revokeObjectURL(gone.thumb);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      /* Laufende Dateien bleiben – was arbeitet, lässt sich nicht wegkehren. */
      const kept = prev.filter((i) => i.status === "converting" || i.status === "queued");
      for (const i of prev) if (i.thumb && !kept.includes(i)) URL.revokeObjectURL(i.thumb);
      setSelected((sel) => sel.filter((id) => kept.some((k) => k.id === id)));
      return kept;
    });
  }, []);

  const retry = useCallback(
    (id: string) => patch(id, { status: "ready", message: undefined, progress: 0, repaired: false, attempted: false }),
    [patch]
  );

  /** Alle Fehler, die ein zweiter Versuch beheben kann, wieder auf „bereit". */
  const retryFailed = useCallback(() => {
    setItems((prev) =>
      prev.map((i) =>
        i.status === "failed" && !i.final
          ? { ...i, status: "ready", progress: 0, message: undefined, repaired: false, attempted: false }
          : i
      )
    );
  }, []);

  /* ───────── Ziel ───────── */

  const chooseDestination = useCallback(async () => {
    const name = await fs.chooseCustomDestination();
    if (name) updateSettings({ destination: "custom", customDestinationName: name });
  }, [updateSettings]);

  const useCustomDestination = useCallback(() => {
    if (settings.customDestinationName) updateSettings({ destination: "custom" });
  }, [settings.customDestinationName, updateSettings]);

  const forgetDestinations = useCallback(async () => {
    await fs.forgetFolders();
    updateSettings({ destination: "auto", customDestinationName: "" });
  }, [updateSettings]);

  /* ───── Drehen · Zuschneiden · Schneiden – pro Datei, nicht pro Preset ───── */

  /**
   * Legt die Anpassungen einer Datei fest.
   * Eine bereits fertige Datei wird wieder bereit – sonst läge ein Ergebnis
   * herum, das nicht mehr zeigt, was die Datei ist.
   */
  const setAdjustments = useCallback((id: string, adj: Adjustments) => {
    setItems((arr) =>
      arr.map((i) => {
        if (i.id !== id) return i;
        const next = { ...i, adjustments: adj };
        if (i.status === "done" || i.status === "failed") {
          next.status = "ready";
          next.progress = 0;
        }
        return next;
      })
    );
  }, []);

  /** Dieselben Anpassungen für alle Dateien – spart Klicks bei einer Serie. */
  const applyAdjustmentsToAll = useCallback((adj: Adjustments) => {
    setItems((arr) =>
      arr.map((i) => {
        if (!i.info || !i.info.video) return i;
        const next = { ...i, adjustments: adj };
        if (i.status === "done" || i.status === "failed") {
          next.status = "ready";
          next.progress = 0;
        }
        return next;
      })
    );
  }, []);

  /* ───────── Konvertieren ───────── */

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const start = useCallback(async () => {
    if (running || planning || collecting || abortRef.current) return;
    const issue = engine === webEngine ? webPresetIssue(preset) : null;
    if (issue) { setNotice(issue); return; }
    const scope = selected.length ? selected : null;
    const todo = itemsRef.current.filter(
      (i) => i.status === "ready" && i.info && (!scope || scope.includes(i.id))
    );
    if (!todo.length || itemsRef.current.some((i) => i.status === "checking")) return;

    const ac = new AbortController();
    abortRef.current = ac;
    setNotice(null);
    setPlanning(true);

    let targets: Map<string, Target>;
    try {
      const sources = todo.map((i) => i.source);
      targets = await fs.planTargets(sources, settings);
      /*
       * Mehrere Dateien in den Download-Ordner kommen oft nicht an: Der Browser
       * erlaubt Mehrfach-Downloads nur nach Rückfrage, und wer die wegklickt,
       * verliert den Rest des Laufs – ohne Meldung. Deshalb fragt die App hier
       * einmal nach einem Zielordner. Der Klick auf „Konvertieren" ist die
       * Geste, die dieser Dialog verlangt.
       */
      const loose = [...targets.values()].filter((t) => t.kind === "download").length;
      if (loose > 1) {
        throw new Error("Bitte zuerst über das Ziel-Menü einen Zielordner wählen. Mehrfach-Downloads können vom Browser unbemerkt blockiert werden. Es wurde nichts konvertiert.");
      }
    } catch (e) {
      abortRef.current = null;
      setPlanning(false);
      setNotice(e instanceof Error ? e.message : "Der Zielordner konnte nicht vorbereitet werden. Es wurde nichts konvertiert.");
      return;
    }

    setPlanning(false);
    abortRef.current = ac;
    setRunning(true);
    setOverall({ fraction: 0, completed: 0, total: todo.length });

    const ids = new Set(todo.map((i) => i.id));
    setItems((prev) =>
      prev.map((i) =>
        ids.has(i.id) ? { ...i, status: "queued", progress: 0, message: undefined, repaired: false, attempted: true } : i
      )
    );

    const current = preset;
    const ext = CONTAINERS[current.container].ext;
    const totalDur = todo.reduce((s, i) => s + (i.info?.duration || 1), 0);
    const processed = new Map<string, number>();
    let completed = 0;
    const t0 = performance.now();
    let lastEmit = 0;

    const emit = () => {
      let sum = 0;
      processed.forEach((v) => (sum += v));
      const fraction = Math.min(1, sum / totalDur);
      const elapsed = (performance.now() - t0) / 1000;
      const eta = fraction > 0.04 && elapsed > 4 ? (elapsed * (1 - fraction)) / fraction : undefined;
      setOverall({ fraction, eta, completed, total: todo.length });
    };

    // Automatisch: mit Grafikkarte zwei Dateien parallel, sonst eine. Überschreibbar.
    const automatic = settings.hardware === "auto" && hardware.available ? 2 : 1;
    const limit = createLimiter(settings.concurrency > 0 ? settings.concurrency : automatic);
    await Promise.all(
      todo.map((item) =>
        limit(async () => {
          if (ac.signal.aborted) {
            patch(item.id, { status: "ready", progress: 0 });
            return;
          }
          const info = item.info!;
          const dur = info.duration || 1;
          patch(item.id, { status: "converting", progress: 0 });
          try {
            const target: Target = targets.get(item.id) ?? { kind: "download" };
            const res = await engine.convert({
              source: item.source,
              info,
              preset: current,
              adj: item.adjustments,
              hardware: settings.hardware,
              signal: ac.signal,
              openOutput: () => fs.open(target, item.source, ext, settings),
              onProgress: (fraction) => {
                processed.set(item.id, fraction * dur);
                const now = performance.now();
                if (now - lastEmit > 120) {
                  lastEmit = now;
                  patch(item.id, { progress: fraction });
                  emit();
                }
              },
            });
            processed.set(item.id, dur);
            if (res.status === "skipped")
              patch(item.id, { status: "done", progress: 1, message: "Übersprungen – existiert bereits", outSize: undefined });
            else {
              const healed =
                item.health.state === "repair"
                  ? item.health.note.includes("Länge")
                    ? "Die fehlende Länge wurde neu berechnet."
                    : "Die Datei war unvollständig. Der lesbare Teil wurde gerettet."
                  : undefined;
              patch(item.id, {
                status: "done",
                progress: 1,
                outSize: res.size,
                delivery: res.delivery,
                outPlace: res.place,
                message: res.note ?? healed,
                repaired: !!res.repaired || (!res.note && !!healed),
              });
            }
          } catch (e) {
            if (engine.isCanceled(e) || ac.signal.aborted) {
              patch(item.id, { status: "ready", progress: 0 });
            } else {
              processed.set(item.id, dur);
              patch(item.id, {
                status: "failed",
                progress: 0,
                message: e instanceof Error ? e.message : String(e),
                final: e instanceof ConvertError ? e.final : false,
              });
            }
          }
          completed++;
          emit();
        })
      )
    );

    abortRef.current = null;
    setRunning(false);
    setOverall(null);
  }, [running, planning, collecting, selected, settings, preset, patch, hardware.available, updateSettings]);

  return {
    presets,
    preset,
    settings,
    items,
    running,
    planning,
    /** Solange gilt: keine Einstellung lässt sich ändern. Ein Zustand, kein Flickwerk. */
    locked: running || planning || collecting || items.some((i) => i.status === "checking"),
    collecting,
    overall,
    notice,
    caps,
    hardware,
    updateSettings,
    selectPreset,
    savePreset,
    createPreset,
    duplicatePreset,
    deletePreset,
    movePreset,
    addFiles,
    addFolder,
    addDrop,
    remove,
    clear,
    retry,
    retryFailed,
    fsSupported: fs.supported,
    selected,
    toggleSelect,
    selectAll,
    clearSelection,
    chooseDestination,
    useCustomDestination,
    forgetDestinations,
    start,
    stop,
    setAdjustments,
    applyAdjustmentsToAll,
    dismissNotice: () => setNotice(null),
  };
}

export type AppApi = ReturnType<typeof useApp>;

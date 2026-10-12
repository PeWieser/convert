import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConvertError, convert, initEngine, isCanceled, probe } from "../lib/engine";
import { baseName } from "../lib/format";
import { CONTAINERS } from "../lib/formats";
import {
  chooseCustomDestination,
  collectFromDrop,
  forgetFolders,
  openOutput,
  pickFiles,
  pickFolder,
  planTargets,
} from "../lib/fsa";
import type { Target } from "../lib/fsa";
import { detectHardware } from "../lib/hardware";
import { BASE_AUDIO, BASE_VIDEO, cloneAsNew, defaultPresets, factoryPreset, normalizePreset } from "../lib/presets";
import { createLimiter } from "../lib/queue";
import { DEFAULT_SETTINGS, usePersistent } from "../lib/storage";
import type { Capabilities, Item, Preset, Settings, SourceFile } from "../lib/types";

const sameFile = (a: SourceFile, b: SourceFile) =>
  a.name === b.name &&
  a.file.size === b.file.size &&
  a.file.lastModified === b.file.lastModified &&
  a.relDirs.join("/") === b.relDirs.join("/");

export interface Overall {
  fraction: number;
  completed: number;
  total: number;
  eta?: number;
}

export function useApp() {
  const [presets, setPresets] = usePersistent<Preset[]>("wandler.presets.v1", defaultPresets, (stored) =>
    Array.isArray(stored) && stored.length
      ? stored.map((p) => ({ ...p, video: { ...BASE_VIDEO, ...p.video }, audio: { ...BASE_AUDIO, ...p.audio } }))
      : defaultPresets()
  );
  const [settings, setSettings] = usePersistent<Settings>(
    "wandler.settings.v1",
    () => DEFAULT_SETTINGS,
    (s) => ({ ...DEFAULT_SETTINGS, ...s })
  );
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [overall, setOverall] = useState<Overall | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [caps, setCaps] = useState<Capabilities>({ video: [], audio: [], ready: false });
  const hardware = useMemo(() => detectHardware(), []);

  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const abortRef = useRef<AbortController | null>(null);
  const probeLimit = useRef(createLimiter(2)).current;

  useEffect(() => {
    initEngine().then(setCaps);
  }, []);

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
    setItems((prev) =>
      prev.some((i) => i.attempted)
        ? prev.map((i) =>
            (i.status === "done" || (i.status === "failed" && i.health.state !== "broken")) && i.info
              ? { ...i, status: "ready", progress: 0, message: undefined, outSize: undefined, outPlace: undefined, repaired: false, final: false, attempted: false }
              : { ...i, attempted: false }
          )
        : prev
    );
  }, []);

  const selectPreset = useCallback(
    (id: string) => {
      if (id !== settings.selectedPresetId) rearm();
      updateSettings({ selectedPresetId: id });
    },
    [updateSettings, rearm, settings.selectedPresetId]
  );

  const updatePreset = useCallback(
    (p: Preset) => {
      rearm();
      setPresets((prev) => prev.map((x) => (x.id === p.id ? normalizePreset(p) : x)));
    },
    [setPresets, rearm]
  );

  const addPreset = useCallback(() => {
    const np = cloneAsNew(preset, "Neues Preset");
    delete np.builtin;
    setPresets((prev) => [...prev, np]);
    updateSettings({ selectedPresetId: np.id });
    return np.id;
  }, [preset, setPresets, updateSettings]);

  const duplicatePreset = useCallback(
    (id: string) => {
      const base = presets.find((p) => p.id === id);
      if (!base) return id;
      const np = cloneAsNew(base);
      setPresets((prev) => {
        const i = prev.findIndex((p) => p.id === id);
        const next = [...prev];
        next.splice(i + 1, 0, np);
        return next;
      });
      updateSettings({ selectedPresetId: np.id });
      return np.id;
    },
    [presets, setPresets, updateSettings]
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

  const resetPreset = useCallback(
    (id: string) => {
      setPresets((prev) =>
        prev.map((p) => {
          if (p.id !== id || !p.builtin) return p;
          return { ...factoryPreset(p.builtin), id: p.id };
        })
      );
    },
    [setPresets]
  );

  const resetAllPresets = useCallback(() => {
    setPresets(defaultPresets());
    updateSettings({ selectedPresetId: "preset-mp4" });
  }, [setPresets, updateSettings]);

  /* ───────── Dateien ───────── */

  const patch = useCallback((id: string, p: Partial<Item>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, []);

  const addSources = useCallback(
    (sources: SourceFile[]) => {
      if (!sources.length) return;
      const accepted: SourceFile[] = [];
      for (const s of sources) {
        if (itemsRef.current.some((i) => sameFile(i.source, s))) continue;
        if (accepted.some((a) => sameFile(a, s))) continue;
        accepted.push(s);
      }
      if (!accepted.length) return;
      const fresh: Item[] = accepted.map((s) => ({
        id: s.id,
        source: s,
        status: "checking",
        health: { state: "ok" },
        progress: 0,
      }));
      setItems((prev) => [...prev, ...fresh]);

      for (const s of accepted) {
        probeLimit(async () => {
          let r: Awaited<ReturnType<typeof probe>>;
          try {
            r = await probe(s);
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

  const addFiles = useCallback(async () => addSources(await pickFiles()), [addSources]);
  const addFolder = useCallback(
    async () => addSources(await pickFolder(settings.outFolderName)),
    [addSources, settings.outFolderName]
  );
  const addDrop = useCallback(
    async (dt: DataTransfer) => addSources(await collectFromDrop(dt, settings.outFolderName)),
    [addSources, settings.outFolderName]
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone?.thumb) URL.revokeObjectURL(gone.thumb);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => {
        if (i.status !== "converting" && i.status !== "queued" && i.thumb) URL.revokeObjectURL(i.thumb);
      });
      return prev.filter((i) => i.status === "converting" || i.status === "queued");
    });
  }, []);

  const retry = useCallback(
    (id: string) => patch(id, { status: "ready", message: undefined, progress: 0, repaired: false, attempted: false }),
    [patch]
  );

  /* ───────── Ziel ───────── */

  const chooseDestination = useCallback(async () => {
    const dir = await chooseCustomDestination();
    if (dir) updateSettings({ destination: "custom", customDestinationName: dir.name });
  }, [updateSettings]);

  const useCustomDestination = useCallback(() => {
    if (settings.customDestinationName) updateSettings({ destination: "custom" });
  }, [settings.customDestinationName, updateSettings]);

  const forgetDestinations = useCallback(async () => {
    await forgetFolders();
    updateSettings({ destination: "auto", customDestinationName: "" });
  }, [updateSettings]);

  /* ───────── Konvertieren ───────── */

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const start = useCallback(async () => {
    if (running || planning) return;
    const todo = itemsRef.current.filter((i) => i.status === "ready" && i.info);
    if (!todo.length || itemsRef.current.some((i) => i.status === "checking")) return;

    const ac = new AbortController();
    setNotice(null);
    setPlanning(true);

    let targets: Map<string, Target>;
    try {
      targets = await planTargets(
        todo.map((i) => i.source),
        settings
      );
    } catch (e) {
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

    // Smart: Mit GPU zwei Dateien parallel, sonst eine – keine Einstellung nötig.
    const limit = createLimiter(settings.hardware === "auto" && hardware.available ? 2 : 1);
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
            const res = await convert({
              source: item.source,
              info,
              preset: current,
              hardware: settings.hardware,
              signal: ac.signal,
              openOutput: () => openOutput(target, baseName(item.source.name), ext, settings, item.source.handle),
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
                outPlace: res.place,
                message: res.note ?? healed,
                repaired: !!res.repaired || (!res.note && !!healed),
              });
            }
          } catch (e) {
            if (isCanceled(e) || ac.signal.aborted) {
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
  }, [running, planning, settings, preset, patch, hardware.available]);

  return {
    presets,
    preset,
    settings,
    items,
    running,
    planning,
    overall,
    notice,
    caps,
    hardware,
    updateSettings,
    selectPreset,
    updatePreset,
    addPreset,
    duplicatePreset,
    deletePreset,
    resetPreset,
    resetAllPresets,
    addFiles,
    addFolder,
    addDrop,
    remove,
    clear,
    retry,
    chooseDestination,
    useCustomDestination,
    forgetDestinations,
    start,
    stop,
    dismissNotice: () => setNotice(null),
  };
}

export type AppApi = ReturnType<typeof useApp>;

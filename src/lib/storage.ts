import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  hardware: "auto",
  outFolderName: "Konvertiert",
  collision: "number",
  concurrency: 0,
  appearance: "auto",
  destination: "auto",
  customDestinationName: "",
  selectedPresetId: "preset-mp4",
};

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher voll oder gesperrt – ignorieren */
  }
}

/** useState, das sich automatisch in localStorage merkt. */
export function usePersistent<T>(key: string, initial: () => T, merge?: (stored: T) => T) {
  const [value, setValue] = useState<T>(() => {
    const fresh = initial();
    const stored = loadJSON<T | null>(key, null);
    if (stored == null) return fresh;
    return merge ? merge(stored) : stored;
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveJSON(key, value);
  }, [key, value]);
  const update = useCallback((patch: T | ((prev: T) => T)) => setValue(patch), []);
  return [value, update] as const;
}

/* ───────────── IndexedDB (für Ordner-Zugriffe) ───────────── */

const DB_NAME = "wandler";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignorieren */
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignorieren */
  }
}

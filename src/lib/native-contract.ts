import type { Adjustments, Capabilities, FileMetadata, HardwareInfo, Preset, Settings } from "./types";
import type { ProbeResult } from "./engine";
import type { Target } from "./platform";

export interface NativeSource {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  relDirs: string[];
  previewUrl: string;
}
export interface NativeOutput { id: string; place: string }
export interface NativeConversion {
  sourceId: string;
  outputId: string;
  preset: Preset;
  adj: Adjustments;
  /** Was in der Ausgabe stehen soll. Rein serialisierbar – kein Blob, kein Handle. */
  metadata?: FileMetadata;
  hardware: Settings["hardware"];
}
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string; canceled?: boolean };
export interface NativeBridge {
  init(): Promise<Reply<Capabilities>>;
  hardware(): Promise<Reply<HardwareInfo>>;
  pickFiles(): Promise<Reply<NativeSource[]>>;
  pickFolder(skip: string): Promise<Reply<NativeSource[]>>;
  drop(files: File[], skip: string): Promise<Reply<NativeSource[]>>;
  chooseDestination(): Promise<Reply<string | null>>;
  forgetFolders(): Promise<Reply<void>>;
  plan(ids: string[], settings: Settings): Promise<Reply<[string, Target][]>>;
  open(target: Target, sourceId: string, ext: string, settings: Settings): Promise<Reply<NativeOutput | null>>;
  finish(outputId: string): Promise<Reply<number>>;
  discard(outputId: string): Promise<Reply<void>>;
  probe(sourceId: string): Promise<Reply<ProbeResult>>;
  convert(req: NativeConversion): Promise<Reply<void>>;
  cancel(outputId: string): void;
  onProgress(listener: (id: string, fraction: number, seconds: number) => void): () => void;
  window(action: "minimize" | "maximize" | "close"): void;
  progress(fraction: number): void;
}
declare global { interface Window { wandler?: NativeBridge } }

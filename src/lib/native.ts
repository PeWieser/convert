import type { NativeSource, Reply } from "./native-contract";
import type { MediaEngine, PlatformFS } from "./platform";
import type { SourceFile } from "./types";

async function unwrap<T>(reply: Promise<Reply<T>>): Promise<T> {
  const r = await reply;
  if (!r.ok) {
    if (r.canceled) throw new DOMException("Abgebrochen", "AbortError");
    throw new Error(r.error);
  }
  return r.value;
}
const source = (s: NativeSource): SourceFile => ({ ...s, native: { size: s.size, lastModified: s.lastModified, previewUrl: s.previewUrl } });

export function nativePlatform() {
  const bridge = window.wandler;
  if (!bridge) return null;
  const fs: PlatformFS = {
    supported: true,
    pickFiles: async () => (await unwrap(bridge.pickFiles())).map(source),
    pickFolder: async (skip) => (await unwrap(bridge.pickFolder(skip))).map(source),
    collectFromDrop: async (dt, skip) => (await unwrap(bridge.drop(Array.from(dt.files), skip))).map(source),
    planTargets: async (sources, settings) => new Map(await unwrap(bridge.plan(sources.map((s) => s.id), settings))),
    chooseCustomDestination: () => unwrap(bridge.chooseDestination()),
    forgetFolders: () => unwrap(bridge.forgetFolders()),
    async open(target, src, ext, settings) {
      const out = await unwrap(bridge.open(target, src.id, ext, settings));
      return out && { path: out.id, place: out.place, delivery: "saved", finish: () => unwrap(bridge.finish(out.id)), discard: () => unwrap(bridge.discard(out.id)) };
    },
  };
  const engine: MediaEngine = {
    init: () => unwrap(bridge.init()),
    hardware: () => unwrap(bridge.hardware()),
    probe: (src) => unwrap(bridge.probe(src.id)),
    isCanceled: (e) => e instanceof DOMException && e.name === "AbortError",
    async convert(req) {
      if (req.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
      const out = await req.openOutput();
      if (!out) return { status: "skipped", size: 0, place: "" };
      const id = out.path!;
      const unsubscribe = bridge.onProgress((outputId, fraction, seconds) => {
        if (outputId === id) req.onProgress(fraction, seconds);
      });
      const cancel = () => bridge.cancel(id);
      req.signal.addEventListener("abort", cancel);
      try {
        if (req.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
        await unwrap(bridge.convert({ sourceId: req.source.id, outputId: id, preset: req.preset, adj: req.adj, hardware: req.hardware }));
        if (req.signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
        const size = await out.finish();
        return { status: "done", size, place: out.place, delivery: "saved" };
      } catch (e) { await out.discard().catch(() => undefined); throw e; }
      finally { unsubscribe(); req.signal.removeEventListener("abort", cancel); }
    },
  };
  return { fs, engine };
}

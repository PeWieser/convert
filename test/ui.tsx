import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PresetBar } from "../src/components/PresetBar";
import { FileRow } from "../src/components/FileRow";
import { FileInspector } from "../src/components/FileInspector";
import { defaultPresets, cloneAsNew } from "../src/lib/presets";
import { moveTo } from "../src/lib/order";
import "../src/index.css";

function Harness() {
  const [presets, setPresets] = useState(() => [...defaultPresets(), cloneAsNew(defaultPresets()[1], "Drittes Preset")]);
  const [selectedId, select] = useState(presets[0].id);
  const [locked, setLocked] = useState(false);
  /*
   * Der Inspektor ist ein Fenster über der ganzen Seite. Er wird deshalb erst
   * auf Klick montiert – sonst läge er über allen anderen Prüfungen und
   * finge deren Klicks ab.
   */
  const [inspecting, setInspecting] = useState(false);
  return <div style={{ padding: 40 }}>
    <PresetBar presets={presets} selectedId={selectedId} disabled={false} canDelete onSelect={select} onReorder={(id, to) => setPresets((prev) => moveTo(prev, prev.findIndex((p) => p.id === id), to))} onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}} onAdd={() => {}} onOpenGrid={() => {}} />
    <button onClick={() => setLocked(!locked)}>Sperre umschalten</button>
    <button onClick={() => setInspecting(true)}>Inspektor öffnen</button>
    <ul><FileRow item={{ id: "f1", source: { id: "f1", file: new File(["test"], "Film.mp4"), name: "Film.mp4", relDirs: [] }, status: "done", health: { state: "ok" }, progress: 1, outSize: 1000, adjustments: { rotate: 0 } }} preset={presets[0]} onRemove={() => {}} onRetry={() => {}} locked={locked} /></ul>
    {/* Der Metadaten-Reiter mit einer Datei, die schon einen Titel trägt. */}
    {inspecting && <FileInspector
      item={{
        id: "f2",
        source: { id: "f2", file: new File(["test"], "Serie.S01E02.mkv"), name: "Serie.S01E02.mkv", relDirs: [] },
        status: "ready",
        health: { state: "ok" },
        progress: 0,
        adjustments: { rotate: 0 },
        info: { format: "matroska", duration: 60, size: 1000, video: { codec: "avc", width: 640, height: 360, fps: 25, bitrate: 0, rotation: 0, hdr: false }, tags: { title: "Der Anfang" } },
      }}
      preset={presets[1]}
      caps={{ video: ["h264"], audio: ["aac"], ready: true, subtitles: false, metadata: true, cover: false }}
      tmdbKey=""
      tmdbLanguage="de"
      onClose={() => setInspecting(false)}
      onFinish={() => {}}
      onApplyToAll={() => {}}
      onApplyMetadataToAll={() => {}}
      onOpenSettings={() => {}}
    />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);

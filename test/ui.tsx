import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PresetBar } from "../src/components/PresetBar";
import { FileRow } from "../src/components/FileRow";
import { defaultPresets, cloneAsNew } from "../src/lib/presets";
import { moveTo } from "../src/lib/order";
import "../src/index.css";

function Harness() {
  const [presets, setPresets] = useState(() => [...defaultPresets(), cloneAsNew(defaultPresets()[1], "Drittes Preset")]);
  const [selectedId, select] = useState(presets[0].id);
  const [locked, setLocked] = useState(false);
  return <div style={{ padding: 40 }}>
    <PresetBar presets={presets} selectedId={selectedId} disabled={false} canDelete onSelect={select} onReorder={(id, to) => setPresets((prev) => moveTo(prev, prev.findIndex((p) => p.id === id), to))} onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}} onAdd={() => {}} onOpenGrid={() => {}} />
    <button onClick={() => setLocked(!locked)}>Sperre umschalten</button>
    <ul><FileRow item={{ id: "f1", source: { id: "f1", file: new File(["test"], "Film.mp4"), name: "Film.mp4", relDirs: [] }, status: "done", health: { state: "ok" }, progress: 1, outSize: 1000, adjustments: { rotate: 0 } }} preset={presets[0]} onRemove={() => {}} onRetry={() => {}} locked={locked} /></ul>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);

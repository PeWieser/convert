import { useState } from "react";
import type { HardwareInfo, Settings } from "../lib/types";
import { Btn, Group, Row, Segmented, Select, Sheet, Switch, TextField } from "./ui";

export function SettingsSheet({
  settings,
  hardware,
  onChange,
  onClose,
  onForgetFolders,
}: {
  settings: Settings;
  hardware: HardwareInfo;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onForgetFolders: () => void;
}) {
  const [forgotten, setForgotten] = useState(false);

  return (
    <Sheet title="Einstellungen" onClose={onClose} width={480}>
      <header className="flex items-center justify-between px-6 pb-2 pt-5">
        <h2 className="text-[20px] font-semibold tracking-tight">Einstellungen</h2>
        <Btn variant="primary" onClick={onClose}>
          Fertig
        </Btn>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-6 pt-3">
        <Group title="Allgemein">
          <Row label="Erscheinungsbild">
            <Segmented
              value={settings.appearance}
              onChange={(a) => onChange({ appearance: a })}
              options={[
                { value: "auto", label: "System" },
                { value: "light", label: "Hell" },
                { value: "dark", label: "Dunkel" },
              ]}
            />
          </Row>
        </Group>

        <Group title="Leistung">
          <Row
            label="Grafikkarte verwenden"
            sub={
              hardware.available
                ? [hardware.gpu, hardware.encoder].filter(Boolean).join(" · ")
                : hardware.hidden
                  ? "Der Browser verdeckt die Grafikkarte – konvertiert wird trotzdem"
                  : "Keine Grafikkarte gefunden"
            }
          >
            <Switch
              disabled={!hardware.available}
              checked={settings.hardware === "auto" && hardware.available}
              onChange={(on) => onChange({ hardware: on ? "auto" : "off" })}
            />
          </Row>
          <Row
            label="Parallele Dateien"
            sub="Automatisch: zwei mit Grafikkarte, sonst eine."
          >
            <Select
              value={settings.concurrency}
              onChange={(n) => onChange({ concurrency: n })}
              options={[
                { value: 0, label: "Automatisch" },
                { value: 1, label: "1 Datei" },
                { value: 2, label: "2 Dateien" },
                { value: 3, label: "3 Dateien" },
                { value: 4, label: "4 Dateien" },
              ]}
            />
          </Row>
        </Group>

        <Group title="Ausgabe">
          <Row label="Ordnername">
            <TextField
              value={settings.outFolderName}
              placeholder="Konvertiert"
              onChange={(v) => onChange({ outFolderName: v.replace(/[\\/:*?"<>|]/g, "") })}
            />
          </Row>
          <Row label="Gemerkte Ordner">
            <Btn
              variant="plain"
              disabled={forgotten}
              onClick={() => {
                onForgetFolders();
                setForgotten(true);
              }}
            >
              {forgotten ? "Vergessen" : "Vergessen …"}
            </Btn>
          </Row>
          <Row label="Wenn Datei existiert">
            <Select
              value={settings.collision}
              onChange={(c) => onChange({ collision: c })}
              options={[
                { value: "number", label: "Beide behalten" },
                { value: "overwrite", label: "Ersetzen" },
                { value: "skip", label: "Überspringen" },
              ]}
            />
          </Row>
        </Group>

      </div>
    </Sheet>
  );
}

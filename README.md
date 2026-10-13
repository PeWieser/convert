# Wandler

Videos und Musik konvertieren — ohne Umweg, ohne Fachsprache, ohne Upload.
Dateien reinziehen, Format wählen, konvertieren. Die Dateien bleiben auf dem Rechner.

Design-Sprache: Apple Human Interface Guidelines (eigene Token in `src/index.css`,
eigens gezeichnete Glyphen, gruppierte Listen wie in den iOS-Einstellungen).

---

## Zwei Ziele, ein Produkt

| | Web-App | Windows-App |
|---|---|---|
| Engine | **Mediabunny** (WebCodecs) | **FFmpeg** (NVENC · AMF · Quick Sync) |
| Dateizugriff | File System Access API | `node:fs` über Electron-IPC |
| Bau | `npm run build` → *eine* HTML-Datei | `desktop/` (geplant, Phase 5) |
| Untertitel | — (die Engine kann es nicht) | beibehalten · einbrennen · entfernen |

Beide bauen auf **demselben Job-Modell** auf: `Preset + MediaInfo + Adjustments → Job`,
und zwei Renderer machen daraus entweder `ConversionOptions` oder ein FFmpeg-Argument-Array.

---

## Bedienung

- **Preset** = was hinten rauskommen soll (Format, Codec, Qualität). Der Editor gliedert
  sich in **Kategorien** — `Format · Video · Bild · Ton · Experten · Befehl` — und zeigt
  nur, was beim gewählten Format überhaupt etwas bewirkt. Änderungen sind ein **Entwurf**:
  `Fertig` speichert, `Abbrechen` nicht. Duplizieren und Löschen sitzen im Menü
  der Preset-Karte (drei Punkte).
- **Datei** = was mit *dieser einen* Datei ist (Drehen, Zuschneiden, Trimmen, Untertitel).
  Doppelklick auf eine Zeile öffnet den Datei-Inspektor mit Player.
- **Während der Konvertierung ist alles gesperrt** — mit sichtbarem Grund.
  Nichts lässt sich ändern, was ohnehin nicht wirkt.
- `⌘/Strg + O` Dateien · `⇧⌘/Strg + O` Ordner · `⌘/Strg + ↩` konvertieren ·
  `⌘/Strg + ,` Einstellungen · `Esc` schließt

Das Ziel ergibt sich von selbst: Dateien aus einem Ordner landen im Unterordner
„Konvertiert" neben den Originalen, einzelne Dateien im gemerkten Quellordner,
sonst in den Downloads. Es wird nie ungefragt ein Ordner-Dialog geöffnet.

---

## Entwicklung

```bash
npm install
npm run dev        # Vite auf http://localhost:5173
npm run typecheck  # tsc --noEmit (strict, noUnusedLocals)
npm run build      # eine einzelne HTML-Datei nach dist/
```

### Aufbau

```
src/
├─ App.tsx                  Layout, Sperre, Shortcuts, Drag & Drop
├─ hooks/useApp.ts          gesamter Zustand: Presets, Dateien, Ziel, Lauf
├─ components/
│  ├─ PresetBar.tsx         Preset-Karten (Rail)
│  ├─ Stage.tsx             leere Bühne | Dateiliste
│  ├─ FileRow.tsx           eine Datei: Thumb, Status, Fortschritt
│  ├─ Footer.tsx            Ziel · Fortschritt · Konvertieren/Stoppen
│  ├─ PresetEditor.tsx      Preset-Entwurf (Einfach | Profi)
│  ├─ SettingsSheet.tsx     Allgemein · Leistung · Ausgabe · Zurücksetzen
│  ├─ PresetIcon.tsx        eigene Glyphen
│  └─ ui.tsx                Btn · Group · Row · Select · Segmented · Switch · Slider · Sheet
└─ lib/
   ├─ types.ts              das gemeinsame Vokabular – die UI kennt nur diese Typen
   ├─ presets.ts            Presets, Geometrie, Copy-Heuristik, Größenschätzung
   ├─ engine.ts             Web-Engine: initEngine · probe · convert (Mediabunny)
   ├─ ffmpeg.ts             baut den FFmpeg-Befehl (heute Vorschau, ab Phase 5 ausgeführt)
   ├─ fsa.ts                Picker, Drop, Zielplanung, Ausgabe
   ├─ formats.ts            Container-/Codec-Matrizen
   ├─ hardware.ts           GPU-Erkennung
   ├─ storage.ts            localStorage + IndexedDB
   └─ queue.ts              createLimiter (Parallelität)
```

Die Reparatur-Kaskade in `engine.ts:convert()` ist das Herzstück: GPU scheitert → Software;
Datei bricht mittendrin → den lesbaren Teil retten und sagen, was gerettet wurde;
Timestamps kaputt → neu aufbauen. Erst wenn nichts hilft, gibt es einen verständlichen Grund.

---

## Roadmap

Ausführlich in [`docs/AUDIT-UND-PLAN.md`](docs/AUDIT-UND-PLAN.md) — Audit mit Befunden,
Prioritäten und Belegen, Urteil aus Produktsicht, Zielbild und Phasenplan.

- [x] **Phase 0** — Repo-Hygiene: Name, Version, `.gitignore`, README
- [x] **Phase 1** — Ehrlichkeit und Sperren: Preset als Entwurf, globaler Lock,
      Stoppen mit Bestätigung, Fehler bleiben sichtbar, tote Einstellungen angeschlossen,
      Untertitel-Regler im Web entfernt
- [ ] **Phase 2** — Datei-Inspektor: Player per Doppelklick, Drehen, Zuschneiden, Trimmen
- [ ] **Phase 3** — ein Job-Modell, zwei Renderer (`lib/job.ts`)
- [x] **Phase 4a** — Preset-Editor neu: Kategorien mit Seitennavigation statt
      „Einfach | Profi", `Abbrechen`/`Fertig` unten links, drei Punkte mit Menü
      (Einstellungen · Duplizieren · Löschen) auf jeder Preset-Karte
- [ ] **Phase 4b** — Einstellungen gliedern, Preset-Verwaltung bei vielen Einträgen
- [ ] **Phase 5** — Windows-App: Electron + FFmpeg

## Lizenzen

Mediabunny (MIT) · React (MIT) · Tailwind CSS (MIT) · lucide-react (ISC).
FFmpeg kommt in Phase 5 dazu — die Wahl zwischen LGPL- und GPL-Build ist dort dokumentiert.

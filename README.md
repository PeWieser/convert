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
`src/lib/job.ts` ist dafür die einzige Wahrheit — es rechnet Drehung, Beschnitt, Schnitt,
Zielgröße und Kopier-Entscheidung einmal aus, beide Engines bedienen sich daran.

---

## Bedienung

- **Preset** = was hinten rauskommen soll (Format, Codec, Qualität). Der Editor gliedert
  sich in **Kategorien** — `Format · Video · Bild · Ton · Experten · Befehl` — und zeigt
  nur, was beim gewählten Format überhaupt etwas bewirkt. Der Rahmen hat eine feste Größe.
  Jeder Wert, der vom gespeicherten Stand abweicht, trägt einen **grünen Haken**;
  beim Überfahren wird er zu Undo in Orange und stellt genau diesen Wert zurück.
  `Fertig` speichert, `Abbrechen` nicht — beide unten rechts. Duplizieren und Löschen
  sitzen im Menü der Preset-Karte (drei Punkte).
- **Datei** = was mit *dieser einen* Datei ist. **Doppelklick auf eine Zeile** spielt sie
  ab und öffnet den Inspektor mit drei Werkzeugen: **Drehen · Zuschneiden · Schneiden**.
  Auch hier gilt das Haken-Muster — jeder geänderte Wert lässt sich einzeln zurückstellen,
  und in der Dateiliste steht danach kurz, was mit der Datei los ist (`90° gedreht · gekürzt`).
  `Auf alle anwenden` überträgt den Entwurf auf jede Datei mit Bild.
- **Während der Konvertierung ist alles gesperrt** — mit sichtbarem Grund.
  Nichts lässt sich ändern, was ohnehin nicht wirkt. Ein geöffneter Inspektor schließt sich.
- `⌘/Strg + O` Dateien · `⇧⌘/Strg + O` Ordner · `⌘/Strg + ↩` konvertieren ·
  `⌘/Strg + ,` Einstellungen · `Esc` schließt
- Im Inspektor: `Leertaste` spielt/pausiert · `←`/`→` spulen 5 s · mit `⇧` 1 s

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
│  ├─ FileRow.tsx           eine Datei: Thumb, Status, Fortschritt, Anpassungen
│  ├─ FileInspector.tsx     eine Datei bearbeiten: Player · Drehen · Zuschneiden · Schneiden
│  ├─ Footer.tsx            Ziel · Fortschritt · Konvertieren/Stoppen
│  ├─ PresetEditor.tsx      Preset-Entwurf in Kategorien, mit Änderungs-Haken
│  ├─ SettingsSheet.tsx     Allgemein · Leistung · Ausgabe · Zurücksetzen
│  ├─ PresetIcon.tsx        eigene Glyphen
│  └─ ui.tsx                Btn · Group · Row · Select · Segmented · Switch · Slider · Sheet
└─ lib/
   ├─ types.ts              das gemeinsame Vokabular – die UI kennt nur diese Typen
   ├─ presets.ts            Presets, Skalierungs-Geometrie, Copy-Heuristik
   ├─ job.ts                Preset + Analyse + Anpassungen → ein Auftrag für beide Engines
   ├─ engine.ts             Web-Engine: initEngine · probe · convert (Mediabunny)
   ├─ ffmpeg.ts             baut den FFmpeg-Befehl (heute Vorschau, ab Phase 5 ausgeführt)
   ├─ fsa.ts                Picker, Drop, Zielplanung, Ausgabe
   ├─ formats.ts            Container-/Codec-Matrizen
   ├─ hardware.ts           GPU-Erkennung
   ├─ storage.ts            localStorage + IndexedDB
   └─ queue.ts              createLimiter (Parallelität)
```

### Reihenfolge der Bildverarbeitung

`Quelle → Drehung aus den Metadaten → eigene Drehung → Beschnitt → Skalierung`

So wollen es Mediabunny und FFmpeg gleichermaßen, und so baut die Vorschau im Inspektor
ihre Geometrie: außen eine achsenparallele Box in der Größe *nach* der Drehung, darin das
gedrehte Bild, darüber das Beschnitt-Rechteck. Das Rechteck liegt dadurch immer waagerecht,
egal wie schief die Aufnahme ist. Ein Beschnitt, der aufs ganze Bild fällt, und ein Schnitt,
der die ganze Datei behält, zählen als keine Änderung — verlustfreies Kopieren bleibt erlaubt.

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
- [x] **Phase 2** — Datei-Inspektor: Player per Doppelklick, Drehen, Zuschneiden, Schneiden.
      Drehen ist damit aus dem Preset ausgezogen — es war nie eine Formateigenschaft.
- [x] **Phase 3** — ein Job-Modell, zwei Renderer (`lib/job.ts`): Web-Engine und
      FFmpeg-Vorschau lesen denselben Auftrag, statt dieselbe Logik zweimal zu bauen
- [x] **Phase 4a** — Preset-Editor neu: Kategorien mit Seitennavigation statt
      „Einfach | Profi", fester Rahmen, `Abbrechen`/`Fertig` unten rechts, Änderungs-Haken
      pro Wert, drei Punkte mit Menü
      (Einstellungen · Duplizieren · Löschen) auf jeder Preset-Karte
- [ ] **Phase 4b** — Einstellungen gliedern, Preset-Verwaltung bei vielen Einträgen
- [ ] **Phase 5** — Windows-App: Electron + FFmpeg

## Lizenzen

Mediabunny (MIT) · React (MIT) · Tailwind CSS (MIT) · lucide-react (ISC).
FFmpeg kommt in Phase 5 dazu — die Wahl zwischen LGPL- und GPL-Build ist dort dokumentiert.

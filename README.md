# Wandler

Videos und Musik konvertieren — ohne Umweg, ohne Fachsprache, ohne Upload.
Dateien reinziehen, Format wählen, konvertieren. Die Dateien bleiben auf dem Rechner.

> **Aktueller Stand:** Web-App plus erste Electron-/FFmpeg-Implementierung. Windows-Installer
> und iTunes-/iPod-Transfer sind noch nicht auf echter Zielhardware abgenommen.
> Das iPod-Preset ist im Browser ausdrücklich gesperrt, statt unzuverlässige Dateien zu erzeugen.
> Befunde, Änderungen, Testnachweise und priorisierte Restarbeit:
> **[`docs/REVIEW-2026-10-13.md`](docs/REVIEW-2026-10-13.md)**.

Design-Sprache: Apple Human Interface Guidelines (eigene Token in `src/index.css`,
eigens gezeichnete Glyphen, gruppierte Listen wie in den iOS-Einstellungen).

---

## Zwei Ziele, ein Produkt

| | Web-App | Windows-App |
|---|---|---|
| Engine | **Mediabunny** (WebCodecs) | **FFmpeg** (NVENC · AMF · Quick Sync) |
| Dateizugriff | File System Access API | `node:fs` über Electron-IPC |
| Bau | `npm run build` → *eine* HTML-Datei | `desktop/` → Electron + NSIS (Plattformabnahme offen) |
| Untertitel | — (die Engine kann es nicht) | Beibehalten nach Container; Trackauswahl/Brennen noch offen |

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
- `Strg/⌘ + ←/→` verschiebt das gewählte Preset (Ziehen mit der Maus geht auch)
- `⌘/Strg-Klick` auf eine Datei wählt sie aus, `⌘/Strg + A` alle, `Esc` hebt auf.
  Mit Auswahl konvertiert der Knopf nur die Markierten — Dauer und Schätzung
  im Footer meinen dann genau diese Dateien.

Das Ziel ergibt sich von selbst: Dateien aus einem Ordner landen im Unterordner
„Konvertiert" neben den Originalen, einzelne Dateien im gemerkten Quellordner,
sonst als angeforderter Browser-Download. Für mehrere Dateien ist ein explizites Ordnerziel
nötig; blockierbare Mehrfach-Downloads werden nicht als zuverlässig verkauft. Im Desktop
können auch einzeln gewählte Dateien neben ihren Originalen gespeichert werden.
Es wird nie ungefragt ein Ordner-Dialog geöffnet.

---

## Entwicklung

```bash
npm ci
npm run dev        # Vite auf http://localhost:5173
npm test           # Logik + Sicherheits-/Transaktionstests
npm run typecheck  # tsc --noEmit (strict, noUnusedLocals)
npm run build      # eine einzelne HTML-Datei nach dist/
```

### Windows / Electron

```bash
npm ci
npm ci --prefix desktop
npm run desktop:build
npm run desktop:start
# Auf Windows: Installer (ohne gebündeltes FFmpeg)
npm --prefix desktop run pack
```

Der Installer sucht FFmpeg **und** FFprobe mit libx264/AAC. Nur wenn kein geeigneter
Build vorhanden ist, lädt er den gepinnten Build aus `desktop/ffmpeg-manifest.json`,
prüft SHA-256 und installiert ihn pro Benutzer unter `%LOCALAPPDATA%\Wandler\ffmpeg`.
Fehlt das Netz, bietet die App den Vorgang beim Start erneut an. `FFMPEG_PATH` kann
auf eine eigene FFmpeg-Datei verweisen; FFprobe muss daneben liegen. Unsignierte
Testbuilds können eine SmartScreen-Warnung auslösen.

### Zusätzliche Tests

```bash
npm --prefix desktop run typecheck
npx playwright install chromium
npm run test:ui             # Browser-Interaktionen und OPFS-Transaktion
npm run test:ffmpeg         # benötigt ffmpeg und ffprobe im PATH
```

`FFMPEG_PATH` / `FFPROBE_PATH` erlauben alternative Test-Binaries. Große Testmedien
werden temporär erzeugt, nicht eingecheckt. `checks.yml` führt die Prüfungen aus;
`desktop.yml` baut den Windows-Installer als Workflow-Artefakt. Diese Workflows wurden
hier angelegt/korrigiert, nicht bereits auf GitHub erfolgreich ausgeführt.

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
│  ├─ SettingsSheet.tsx     Allgemein · Leistung · Ausgabe
│  ├─ PresetIcon.tsx        eigene Glyphen
│  └─ ui.tsx                Btn · Group · Row · Select · Segmented · Switch · Slider · Sheet
└─ lib/
   ├─ types.ts              das gemeinsame Vokabular – die UI kennt nur diese Typen
   ├─ presets.ts            Presets, Skalierungs-Geometrie, Copy-Heuristik
   ├─ order.ts              Umsortieren: slotShift · moveTo
   ├─ job.ts                Preset + Analyse + Anpassungen → ein Auftrag für beide Engines
   ├─ engine.ts             Web-Engine: initEngine · probe · convert (Mediabunny)
   ├─ ffmpeg.ts             FFmpeg-Argumente für Vorschau und native Ausführung
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

Die Web-Engine kann bei belegten Decoder-/Timestampfehlern den lesbaren Teil retten und
benennt die Kürzung. **Ausgabefehler sind keine kaputten Videos** und lösen keine Kürzung aus.
Browser-Ordnerausgaben schreiben streamend; Faststart ohne kompletten RAM-Puffer übernimmt
FFmpeg im Desktop. Native Jobs schreiben eine temporäre Datei und prüfen sie vor der Übernahme.

---

## Roadmap

Aktuelle Prioritäten und Abnahmegates in [`docs/REVIEW-2026-10-13.md`](docs/REVIEW-2026-10-13.md).
Der frühere Plan in `docs/AUDIT-UND-PLAN.md` bleibt als historische Einordnung erhalten.

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
- [x] **Phase 4b** — Preset-Verwaltung: Umsortieren, Auswahl-Konvertieren, dauerhaft erreichbarer Grid-Picker.
      Touch/Autoscroll und vollständige Grid-Tastaturbedienung bleiben Nacharbeit.
- [ ] **Phase 5** — Windows-App: Electron + FFmpeg implementiert, Windows-/Installer-Abnahme offen. Ursprünglicher Bauplan in
      [`docs/DESKTOP-PLAN.md`](docs/DESKTOP-PLAN.md), Installer-CI in
      [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)

## Lizenzen

Mediabunny (MIT) · React (MIT) · Tailwind CSS (MIT) · lucide-react (ISC).
Die Mediabunny-Encoder-Erweiterungen für AAC/MP3/FLAC verwenden MPL-2.0.
FFmpeg wird separat als GPL-Build bezogen; Version, Prüfsumme und Bezugsquellen stehen in
`desktop/ffmpeg-manifest.json`. Das Setup behält die mitgelieferten Lizenzdateien bei.
Der getrennte Prozess ist **keine pauschale Aussage über Lizenzfreiheit**. Lizenz- und
Quellenbereitstellung für eine Veröffentlichung müssen anhand des konkreten Builds und
Vertriebsmodells geprüft werden.

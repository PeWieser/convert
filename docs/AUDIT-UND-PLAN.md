# Wandler — Audit & Plan

Stand: 2026-10-12 · Branch `arena/f25fa8b5-convert` · Basis-Commit `f876bc5`
Rolle: Auditor (Produkt-Sicht) + Architekt (Code-Sicht)

---

## Teil 1 — Was das Repo heute ist

**„Wandler"** ist ein Medien-Konverter als reine Web-App: React 19 + Vite 7 + Tailwind 4,
~4.800 Zeilen in 26 Quelldateien, gebaut als **eine einzelne HTML-Datei** (`vite-plugin-singlefile`).
Die Design-Sprache ist konsequent Apple HIG: eigene CSS-Variablen (`--canvas`, `--surface`,
`--fill`, `--label`, `--sep`, `--accent`), Light/Dark, gruppierte Listen wie iOS-Einstellungen,
eigens gezeichnete Glyphen statt Standard-Icons, `cubic-bezier(0.32,0.72,0,1)` als Hauskurve.
**Diese Sprache ist gut und wird nicht angefasst.**

Konvertiert wird **nicht** mit FFmpeg, sondern mit **Mediabunny** (WebCodecs) im Browser.
FFmpeg existiert heute nur als *Text*: `src/lib/ffmpeg.ts` baut einen Befehls-String,
der im Preset-Editor als Vorschau angezeigt und kopiert werden kann. Ausgeführt wird er nirgends.

### Architektur-Karte

```
index.html  ── Theme-Bootstrap aus localStorage
   │
main.tsx → App.tsx ─────────────────────────── Layout, Drag&Drop, Shortcuts
   │            │
   │            ├─ PresetBar      Preset-Karten (Rail, 236 px, horizontal scrollend)
   │            ├─ Stage          leere Bühne  |  Dateiliste
   │            │    └─ FileRow   Thumb, Name, Status, Ring, Entfernen, Erneut
   │            ├─ Footer         Ziel-Menü · Status/Fortschritt · Konvertieren/Stoppen
   │            ├─ PresetEditor   Sheet 600 px, „Einfach | Profi"
   │            └─ SettingsSheet  Sheet 480 px, 3 Gruppen
   │
hooks/useApp.ts ───────────────────────────── gesamte App-Logik (431 Zeilen)
   │
   ├─ lib/presets.ts   Preset-Modelle, Geometrie (planVideoSize), Copy-Heuristik, Größenschätzung
   ├─ lib/engine.ts    Web-Engine: initEngine / probe / convert  (Mediabunny)   ← 547 Zeilen
   ├─ lib/ffmpeg.ts    baut FFmpeg-Befehls-String (nur Vorschau!)
   ├─ lib/fsa.ts       File System Access API: Picker, Drop, Zielplanung, Ausgabe
   ├─ lib/storage.ts   localStorage (usePersistent) + IndexedDB (Ordner-Handles)
   ├─ lib/formats.ts   Container-/Codec-Matrizen, MEDIA_EXTENSIONS, Qualitäts-Labels
   ├─ lib/hardware.ts  GPU-Erkennung über WebGL-Renderer-String
   └─ lib/queue.ts     createLimiter (Parallelität)
```

### Datenfluss einer Konvertierung

1. Dateien rein (Picker, Ordner, Drop) → `SourceFile[]` → `Item[]` mit `status: "checking"`
2. `probe()` je Datei (max. 2 parallel) → `MediaInfo` (Codec, Maße, fps, Bitrate, Dauer),
   `Health` (ok / repair / broken), Thumbnail
3. `start()` → `planTargets()` bestimmt das Ziel (Ordner „Konvertiert" neben den Originalen,
   gemerkter Ordner, sonst Downloads) → alle `ready`-Items werden `queued`
4. Limiter (2 mit GPU, sonst 1) → `convert()` je Datei
5. `convert()` versucht GPU → Software → Reparaturpfade (Ende abschneiden / Timestamps neu
   aufbauen) und meldet erst dann einen verständlichen Fehler
6. Fortschritt pro Datei (Ring) + gesamt (Balken, ETA, Fenstertitel)

### Was genuinely gut ist

- **Die Reparatur-Kaskade** in `engine.ts:convert()` ist das stärkste Stück Code im Repo.
  GPU scheitert → Software. Datei bricht mittendrin → lesbaren Teil retten und *sagen*,
  was gerettet wurde. Timestamps kaputt → neu aufbauen. Das ist Produkt-Denken.
- **Fehler-Übersetzung** (`explainError`, `explainUnreadable`, `explainDiscards`):
  technische Fehler werden zu Sätzen, die ein Mensch versteht. Selten, wertvoll.
- **Smartes Ziel** (`planTargets`): fragt nie ungefragt einen Ordner ab, spiegelt
  Unterordner, merkt sich Ordner in IndexedDB. Durchdacht.
- **Copy-Heuristik** (`willCopyVideo/Audio`): wenn die Quelle schon passt, wird nicht
  neu kodiert. Schnell und verlustfrei, ohne dass der Nutzer davon wissen muss.
- **Design-Disziplin**: ein Token-System, eigene Glyphen, konsistente Radien und Kurven,
  `prefers-reduced-motion`, Fokus-Ringe, ARIA-Rollen, Focus-Trap im Sheet, `tnum` für Zahlen.
- **Electron-Vorarbeit**: `.drag` / `.no-drag` (`-webkit-app-region`) sind schon da,
  der Fenstertitel-Fortschritt auch. Jemand hat mitgedacht.

---

## Teil 2 — Deep Dive: Befunde

Jeder Befund mit Beleg. **P0** = Produkt lügt oder zerstört Arbeit, **P1** = spürbar falsch,
**P2** = Qualität/Hygiene.

### P0-1 · Die Untertitel-Einstellung tut im Web nichts

`Preset.subtitles` ist `"keep" | "burn" | "none"` (`types.ts:61`) und wird an genau zwei
Stellen gelesen: im Preset-Editor (`PresetEditor.tsx:298`) und im **FFmpeg-String-Builder**
(`ffmpeg.ts:72,113,182`). In `engine.ts` — der Engine, die tatsächlich konvertiert — kommt
das Wort `subtitles` **kein einziges Mal** vor.

Beleg: `ConversionOptions` von Mediabunny hat kein Untertitel-Feld (nur `input, output,
tracks, video, audio, trim, copy, tags, showWarnings, composable`).

> **Folge:** Der Nutzer wählt „Untertitel einbrennen", bekommt eine Datei ohne eingebrannte
> Untertitel, und niemand sagt ihm das. „Entfernen" entfernt ebenfalls nichts.
> Das ist die schwerwiegendste Stelle im Produkt: **Ein Regler, der nicht angeschlossen ist.**

Immerhin: `keep`/`none` *wäre* mit einer Zeile machbar — `ConversionOptions.tracks`
(`'all'` behält alle Spuren inkl. Untertitel, `'primary'` verwirft sie). Einbrennen und
das Hinzufügen einer externen `.srt` gehen über `Conversion` **nicht**.

### P0-2 · Preset-Änderungen gelten sofort, global und unwiderruflich

`useApp.ts:110-116`:

```ts
const updatePreset = useCallback((p: Preset) => {
  rearm();                                            // ← setzt fertige Dateien zurück
  setPresets((prev) => prev.map((x) => (x.id === p.id ? normalizePreset(p) : x)));
}, [setPresets, rearm]);
```

Der Preset-Editor ruft `onChange` bei **jeder Slider-Bewegung** auf. Damit:

- Jeder Pixel Slider- Bewegung schreibt dauerhaft nach `localStorage` — es gibt kein
  „Verwerfen", kein „Abbrechen", keinen Entwurf. Einmal angefasst, ist das Preset geändert.
- `rearm()` (`useApp.ts:90-100`) setzt dabei **alle fertigen Dateien** von `done` zurück auf
  `ready`. Wer 40 Dateien konvertiert hat und danach im Preset die Bitrate antippt,
  verliert stillschweigend den gesamten Fertig-Status — die Dateien auf der Platte bleiben,
  die Liste sagt aber wieder „bereit".
- Der Button heißt **„Fertig"** und suggeriert Abschließen, commitet aber längst.

> Genau der Punkt, den du angesprochen hast. Und er ist schlimmer als „unbequem":
> Er **zerstört Zustände**, ohne es zu zeigen.

### P0-3 · Während der Konvertierung ist nicht alles gesperrt

Gesperrt sind: Preset-Auswahl und -Editor (`PresetBar disabled={busy}`), Drag&Drop
(`busyRef`), Ziel-Menü (`Footer: disabled={running || planning}`), Entfernen je Zeile
(`FileRow locked`). 

**Nicht gesperrt ist das Zahnrad.** `App.tsx:108-114` hat kein `disabled`, und der
Shortcut-Handler (`App.tsx:83`) blockiert `⌘,` nur bei offenem Editor/Settings, nicht bei `busy`:

```ts
if (!(e.metaKey || e.ctrlKey) || typing || editingId || showSettings) return;  // busy fehlt
```

Man kann also mitten in einem Lauf „Ordnername", „Wenn Datei existiert", „Grafikkarte"
und das Ziel umstellen. Wirksam wird davon **nichts** — `start()` hat `settings` als
Closure eingefroren (`useApp.ts:343` übergibt das `settings`-Objekt des Aufrufzeitpunkts).

> **Das ist die schlechteste aller Kombinationen:** Die UI erlaubt es, und es wirkt nicht.
> Entweder ehrlich sperren oder live anwenden — aber nicht so tun als ob.

### P1-4 · Zwei tote Einstellungen

`grep` über den gesamten `src/`-Baum:

| Feld | deklariert | Default | UI | gelesen von |
|---|---|---|---|---|
| `Settings.concurrency` | `types.ts:70` | `storage.ts:8` | keine | **niemandem** |
| `Settings.appearance` | `types.ts:71` | `storage.ts:9` | keine | `index.html:16` — und wird dort sofort von `App.tsx:24-30` überschrieben, das hart dem System folgt |

Die Parallelität wird stattdessen hart kodiert: `useApp.ts:324`
`createLimiter(settings.hardware === "auto" && hardware.available ? 2 : 1)`.

Entweder anschließen (beides ist sinnvoll: Thema- Wahl und „wie viele Dateien gleichzeitig")
oder rauswerfen. Tote Felder im Modell sind Schulden.

### P1-5 · Die Engine kann mehr, als die App ihr abverlangt

`ConversionVideoOptions` bietet — von der App **ungenutzt**:

- `crop?: CropRectangle` (`{left, top, width, height}`) → **echtes Zuschneiden**, frei wählbar
- `flip?: boolean` → Spiegeln
- `process?: (sample) => CanvasImageSource | VideoSample | …` → **Frame-Hook**; darüber
  ließe sich sogar Untertitel-Einbrennen im Browser bauen
- `trim.start` → vorhanden, aber nur intern für die Reparatur benutzt (`trimEnd`),
  nie als Nutzer-Funktion

Die App nutzt daraus nur `width/height/fit/rotate/frameRate/keyFrameInterval/quality/codec`.
`„Zuschneiden"` ist heute stattdessen ein **Skalierungsmodus** (`scaling: "crop"` →
`scale=…:force_original_aspect_ratio=increase,crop=w:h`, `ffmpeg.ts:107-108`), also
mittig aufs Zielformat stauchen — nicht das, was ein Mensch unter „zuschneiden" versteht.

> Für Phase 2 ist das die beste Nachricht im ganzen Audit: **Drehen, Zuschneiden und
> Trimmen pro Datei sind in der Web-Engine bereits möglich.** Es fehlt nur die UI und das
> Datenmodell.

### P1-6 · Drehen/Zuschneiden/HDR/10 Bit/Deinterlace liegen im Preset

`VideoSettings` enthält `rotate`, `deinterlace`, `tenBit`, `hdrToSdr`, `maxWidth/maxHeight`,
`scaling` — alles **pro Preset**, also global für jede Datei. Eine gedrehte Aufnahme im Stapel
dreht damit *alle* anderen Dateien mit.

Das ist der Konstruktionsfehler, den du benannt hast, und er ist systemisch:
**Das Preset vermischt zwei verschiedene Dinge** —
(a) *Format-Versprechen* (Container, Codec, Qualität, Bitrate) und
(b) *Fakten über ein einzelnes Stück Material* (Drehung, Beschnitt, Untertitelspur).

### P1-7 · Es gibt keine Vorschau und kein Abspielen

`FileRow.tsx` hat kein `onDoubleClick`, und im gesamten Repo existiert kein `<video>`-Element.
Der einzige Blick auf den Inhalt ist ein 200-px-Thumbnail (`engine.ts:145`, `CanvasSink`).
Doppelklick auf eine Preset-Karte öffnet den Editor (`PresetBar.tsx:138`) — Doppelklick auf
eine Datei tut **nichts**. Inkonsistent und verschenkter Platz.

### P1-8 · „Fertig" im Footer vernichtet die Fehler-Beweise

`Footer.tsx:252`:
```ts
const finished = !running && items.some((i) => i.attempted) && ready.length === 0 && !checking;
```
Bei `finished` wird der primäre Button zu **„Fertig"** → `onClear` → alle Zeilen weg,
inklusive der fehlgeschlagenen und ihrer Begründung. Ein Lauf mit 38 Erfolgen und
2 Fehlern endet also mit einem Button, der die 2 Fehler und ihre Erklärung löscht.

Zwar gibt es pro Zeile ein kleines „Erneut versuchen" (`FileRow.tsx:137-145`, nur bei
`!item.final`), aber der **primäre** Call-to-Action führt in die falsche Richtung.

### P1-9 · „Stoppen" ist sofort und endgültig

`Footer.tsx:373` → `onStop` → `abortRef.current?.abort()`. Keine Bestätigung. Das Repo
kennt das Muster für destruktive Aktionen bereits und nutzt es an zwei Stellen
(`PresetEditor.tsx:551-559` „Wirklich löschen", `SettingsSheet.tsx:270-292`
„Zurücksetzen …") — nur beim Abbruch eines laufenden Jobs nicht, also genau da, wo es
am teuersten ist.

### P2-10 · GPU-Erkennung hängt an einer deprecated WebGL-API

`hardware.ts:12-18` liest `WEBGL_debug_renderer_info` / `UNMASKED_RENDERER_WEBGL`.
Die Extension ist in Firefox als deprecated markiert und zur Entfernung vorgesehen;
in Chrome kann sie je nach Privatsphäre-Einstellung fehlen. Der String wird dann mit
sieben Regexen zurechtgebogen (`hardware.ts:29-37`).

Für die Web-App ist das vertretbar (WebCodecs entscheidet selbst). **Für die Desktop-App
ist es die falsche Quelle:** Dort muss die Wahrheit von FFmpeg kommen
(`ffmpeg -hide_banner -encoders`, ggf. `nvidia-smi`), denn nur FFmpeg weiß, ob
`h264_nvenc` auf *diesem* Rechner wirklich läuft.

### P2-11 · `-map 0:v? -map 0:a?` mit globalem `-vf`

`ffmpeg.ts:71,114`: Es werden **alle** Video-/Audiospuren gemappt, Filter (`-vf`, `-af`)
gelten aber global. Bei Dateien mit mehreren Videospuren erzeugt das einen Fehler statt
einer Konvertierung. Sobald der Befehl wirklich ausgeführt wird (Phase 5), muss hier
`-map 0:v:0` bzw. eine spurweise Filter-Zuordnung stehen.

### P2-12 · Schnellstart wird ab 1,2 GB stillschweigend fallengelassen

`engine.ts:432-433`: `fastStart` wird nur als `"in-memory"` gesetzt, wenn die Quelle
kleiner als 1,2 GB ist; sonst `false`. Das Preset verspricht `fastStart: true`,
die Datei bekommt es nicht, keine Meldung. (Mit FFmpeg in Phase 5 entfällt das Problem —
`-movflags +faststart` schreibt um, egal wie groß.)

### P2-13 · Preset-Editor: 563 Zeilen, zwei parallele JSX-Bäume

`PresetEditor.tsx` rendert `mode === "simple" ? (…150 Zeilen…) : (…380 Zeilen…)`.
`formatRow`, `qualityRow`, `bitrateRow` werden als Variablen geteilt und trotzdem in beiden
Bäumen eingebaut. Der Profi-Zweig ist ein einziger, ~1.200 px langer Scroll ohne Navigation
und ohne Anker. Wer „Entropiekodierung" sucht, scrollt und hofft.

### P2-14 · Preset-Rail skaliert nicht

`PresetBar.tsx:126`: `-mx-3 flex gap-3 overflow-x-auto` mit festen 236-px-Karten.
Bei 2 Presets elegant. Bei 12 Presets ein endloses horizontales Band ohne Übersicht,
ohne Suche, ohne Ordnung. Verwaltung (umbenennen, duplizieren, löschen, Reihenfolge)
ist ausschließlich *im* Editor erreichbar — also nur für das jeweils geöffnete Preset.

### P2-15 · KeinSubset-Konvertieren

`start()` nimmt **alle** Items mit `status === "ready"` (`useApp.ts:275`). Es gibt keine
Auswahl, kein Deaktivieren. Will man 3 von 40 Dateien konvertieren, muss man 37 entfernen
und danach neu hinzufügen. Für einen Stapel-Konverter ein Grundfunktionen-Loch.

### P2-16 · Kein Plattform-Seam für Electron

Die Kommentare behaupten eine saubere Grenze — `engine.ts:9`: *„Die Windows-App ersetzt nur
diese Datei."* Das stimmt nicht. Ersetzt werden müssen **mindestens drei**:

- `engine.ts` (Mediabunny → FFmpeg/ffprobe)
- `fsa.ts` (File System Access API → `node:fs` + native Dialoge)
- `hardware.ts` (WebGL → FFmpeg-Encoder-Probe)

Und die Typen lecken: `Target` enthält `dir: FileSystemDirectoryHandle` (`fsa.ts:184`) —
nicht serialisierbar über Electron-IPC. `useApp.ts` importiert `fsa.ts` direkt,
`Footer.tsx:166` und `fsa.ts:13` exportieren `fsaSupported` als globalen Wahrheitswert,
`engine.ts:50` ebenso `engineSupported`.

> Es gibt heute **keine** Stelle, an der man „Web" gegen „Desktop" tauschen kann.
> Das muss vor dem Electron-Code gebaut werden, sonst wird Electron ein Fork.

**Stand 2026-10-14 — die Naht steht (Web-Seite).** `src/lib/platform.ts` trägt das
gemeinsame Vokabular: `PlatformFS`, `MediaEngine`, `OutputSink`, `FolderRef` und ein
`Target`, das reines JSON ist (`{ kind: "download" }` oder
`{ kind: "folder", folder: { kind, id }, sub: string[] }`) und damit unverändert über
Electron-IPC geht. Lebende Handles bleiben im Renderer, in einem Register in `fsa.ts`
(`internFolder` / `resolveFolder`); der Desktop liefert unter derselben `id` einen Pfad.
`fsa.ts` exportiert `webFS`, `engine.ts` exportiert `webEngine`, `useApp.ts` kennt nur noch
diese beiden Namen und gibt `fsSupported` als Wert weiter — `Footer.tsx` fragt nicht mehr
selbst die Plattform. Die Namensregel liegt als reine, getestete Funktion `chooseName` in
`platform.ts`, damit beide Welten dieselbe Antwort geben.
Noch offen aus diesem Befund: `hardware.ts` (WebGL) hat keine Entsprechung — die Wahrheit
auf dem Desktop muss aus `ffmpeg -encoders` kommen (P2-10).

### P2-17 · Repo-Hygiene

- `package.json`: `"name": "react-vite-tailwind"`, `"version": "0.0.0"` — so wird kein
  Windows-Installer gebaut
- `README.md`: eine Zeile, `# convert`
- ein einziger Commit, `Add files via upload`
- keine Tests, kein Lint, keine CI, keine `.gitignore` im Repo-Stand
- keine Lizenz-Hinweise zu Mediabunny / FFmpeg (FFmpeg + libx264 = **GPL**, relevant für
  die Distribution eines Windows-Builds)

`tsc --noEmit` läuft sauber durch — die Typdisziplin ist gut. Nur ist alles, was getestet
werden müsste (`planVideoSize`, `willCopy*`, `estimateOutputBytes`, `buildFfmpegCommand`),
pure Logik **ohne einen einzigen Test**. Genau die wird in Phase 3 umgebaut.

---

## Teil 3 — Auditor-Urteil

*Jetzt rede ich als der, der Produkte abnimmt.*

---

Dieses Produkt hat Geschmack. Das sieht man in den ersten zwei Sekunden: die Karten, die
Glyphen, die Kurve, mit der das Sheet hereinkommt. Jemand hat sich Mühe gegeben bei Dingen,
die niemand verlangt. Das ist selten, und das ist der Grund, warum wir hier überhaupt reden.

Aber Geschmack ist nicht dasselbe wie Sorgfalt, und an drei Stellen hat die Sorgfalt
aufgehört.

**Erstens: Du lügst den Nutzer an.** „Untertitel einbrennen" — ein Regler, drei Zustände,
schön gesetzt, und dahinter ist nichts angeschlossen. Nichts. Weißt du, was ein Nutzer tut,
der das entdeckt? Er denkt nicht „die Untertitel-Funktion ist kaputt". Er denkt
„*das ganze Programm* ist kaputt". Vertrauen ist keine Eigenschaft einer Funktion,
es ist eine Eigenschaft des Produkts, und man verliert es im Ganzen.
Es gibt dafür nur zwei erlaubte Zustände: **Es funktioniert, oder es ist nicht da.**
Ein ausgegrauter Regler mit einem Satz, warum er ausgegraut ist, ist ehrlich und deshalb
besser als ein funktionierender Regler, der nichts tut.

**Zweitens: Du nimmst dem Menschen die Möglichkeit, etwas zurückzunehmen.**
Ein Preset ist ein Rezept. Wer ein Rezept ändert, will vorher wissen, was er tut, und will
hinterher sagen können „nee, doch nicht". Hier schreibt jeder Millimeter Slider sofort für
immer auf die Platte, und der Button, der das Ganze abschließt, heißt „Fertig" — als wäre
nichts passiert. Schlimmer: Die Änderung wirft stillschweigend 40 fertige Dateien zurück
auf „bereit". Das ist keine Kleinigkeit, das ist Arbeit, die du dem Menschen weggenommen
hast, ohne ein Wort.

Es gibt dafür ein Wort, das alt ist und funktioniert: **Entwurf.** Man ändert. Man sieht,
dass etwas geändert ist. Man speichert — oder man verwirft. Zwei Knöpfe, ein Zustand,
keine Überraschung. Alles andere ist Spielerei.

**Drittens: Du weißt nicht, was eine Einstellung ist.** Das Preset enthält den Codec und
die Bitrate — gut, das ist ein Format. Es enthält aber auch die Drehung. Drehung ist kein
Format. Drehung ist eine Tatsache über *dieses eine* Stück Material, das jemand schief
gehalten hat. Wenn ich eine gedrehte Aufnahme habe, will ich sie drehen — und nicht
zwangsläufig die 39 anderen Dateien gleich mit. Du hast zwei verschiedene Ideen in einen
Kasten gepackt, weil der Kasten schon da war.

Mach zwei Kästen. **Preset: Was soll hinten rauskommen. Datei: Was ist mit dieser einen
Datei.** Das ist kein Feature, das ist Ordnung — und Ordnung ist das, was ein einfaches
Produkt von einem überladenen unterscheidet.

Und dann, der beste Teil: Der Mensch sieht sein Video heute **nirgends**. Ein Thumbnail,
200 Pixel. Er soll aber doppelklicken, das Video sehen, die schiefe Kante *sehen*, den
Beschnitt ziehen, die Untertitel einlegen — und zwar in dem Moment, in dem er das Problem
sieht. Nicht in einem Menü, das er vorher erraten muss.
**Der Moment, in dem man ein Problem sieht, ist der Moment, in dem man es beheben können
muss.** Die Engine kann das übrigens schon — `crop`, `rotate`, `trim` liegen seit Monaten
da und warten. Ihr müsst sie nur abholen.

Zwei Sätze noch zur Disziplin, und dann bin ich fertig:

Wenn die App konvertiert, ist sie beschäftigt. **Dann ist sie beschäftigt.** Nicht das
Zahnrad halb, die Presets ganz, das Ziel ganz und Drag&Drop halb — sondern alles, mit einem
sichtbaren Grund. Ein gesperrtes Bedienelement, das erklärt, warum es gesperrt ist,
beruhigt. Ein halboffenes macht nervös.

Und: Dieses Produkt will nach Windows. Dann hört der Code auf, ein Code zu sein, und wird
zu zwei Implementierungen einer Idee. Wenn ihr den Punkt, an dem sie sich treffen, nicht
*jetzt* definiert — ein Job-Modell, zwei Renderer, ein Dateisystem-Interface — dann habt
ihr in einem Jahr zwei Apps, die sich ähnlich sehen und unterschiedlich verhalten.
Das ist das teuerste Produkt, das man bauen kann.

Was ich **nicht** will: kein neues Design. Die Sprache stimmt. Kein Schnittprogramm, keine
Timeline, keine Cloud, keine 40 neuen Formate. Weniger, aber richtig — und zwar so, dass
man jedem Regler ansieht, ob er angeschlossen ist.

---

## Teil 4 — Zielbild

### 4.1 Informationsarchitektur

Vier Ebenen, klar getrennt. Die drei Zonen des Hauptfensters bleiben, wie sie sind.

```
EBENE 1 · Hauptfenster            (bleibt: Preset-Rail · Dateiliste · Footer)
   │
   ├─ EBENE 2 · Preset-Inspektor   „Was soll hinten rauskommen"  → Draft + Speichern
   │
   ├─ EBENE 3 · Datei-Inspektor    „Was ist mit dieser Datei"    → Doppelklick, sofort wirksam
   │        (Player + Drehen + Zuschneiden + Trimmen + Untertitel)
   │
   └─ EBENE 4 · Einstellungen      „Wie verhält sich die App"    → gegliedert, nichts Totes
```

**Ebene 2 — Preset-Inspektor** (ersetzt den 563-Zeilen-Sheet)

Fenster mit linker Sektions-Navigation, macOS-Systemeinstellungen-Stil — dieselben
`Group`/`Row`-Bausteine, dieselbe Typo, nur nicht mehr als ein endloser Scroll:

| Sektion | Inhalt |
|---|---|
| **Format** | Container, Schnellstart (MP4/MOV), Metadaten |
| **Video** | Codec, Ratensteuerung, Qualität/Bitrate, Encoder-Tempo, Profil/Level |
| **Bild** | Auflösung, Skalierungsverhalten, Bildrate |
| **Ton** | Codec, Bitrate, Abtastrate, Kanäle, Lautstärke angleichen |
| **Untertitel** | *nur Desktop*, sonst ausgegraut mit einem Satz Begründung |
| **Experten** | Keyframe-Abstand, B-Frames, Referenzbilder, Entropie, 2-Pass, 10 Bit, Deinterlace, HDR→SDR |
| **Befehl** | FFmpeg-Vorschau + Kopieren |

„Einfach | Profi" bleibt — steuert dann aber **welche Sektionen sichtbar sind**, statt zwei
getrennte JSX-Bäume zu rendern.

Footer: `Verwerfen` · `Duplizieren` · `Löschen` · **`Speichern`** (primär, nur bei Änderungen aktiv).
Namensfeld und Icon bleiben oben, wo sie sind.

**Ebene 3 — Datei-Inspektor** (neu)

Doppelklick auf eine Zeile → Sheet mit großem Player. Darunter die Werkzeuge:

- **Drehen** — 0 / 90 / 180 / 270, sofort im Player sichtbar (CSS-`transform`, kein Re-Encoding)
- **Zuschneiden** — ziehbares Rechteck über dem Standbild, dazu Vorlagen
  (Original · 16:9 · 4:3 · 1:1 · Seitenverhältnis umdrehen). Echter `CropRectangle`,
  nicht mehr der Skalierungs-Trick.
- **Trimmen** — Start/Ende; Engine kann `trim` bereits
- **Untertitel** — Quelle (im File enthalten / `.srt`-Datei hinzufügen) und Modus
  (beibehalten / einbrennen / entfernen), je nach Plattform ehrlich begrenzt
- **Spurwahl** — Video-/Audiospur, wenn die Datei mehrere hat
- **Ausnahmen** — Auflösung/Qualität nur für diese Datei, Zielordner/Dateiname nur für diese Datei

Buttons: `Zurücksetzen` · `Auf alle anwenden` · `Fertig`.
Hier gilt das **umgekehrte** Speichermodell wie beim Preset: Änderungen sind sofort wirksam,
weil sie nur diese eine Datei betreffen und jederzeit zurücksetzbar sind. Kein Draft nötig —
ein Draft für eine Ausnahme wäre Bürokratie.

Player-Realität: Der Browser spielt nicht alles (WMV, AVI/DivX, MPEG-2, teils HEVC).
Deshalb: **Fallback statt Fehler** — Thumbnail, technische Daten, und die Werkzeuge bleiben
bedienbar (Drehen/Zuschneiden/Trimmen gehen auch ohne Wiedergabe, sie brauchen nur die
Metadaten). In der Desktop-App kann FFmpeg für nicht abspielbare Formate eine
Vorschau-Kopie erzeugen.

**Ebene 4 — Einstellungen** (gegliedert statt drei loser Gruppen)

| Sektion | Inhalt |
|---|---|
| **Allgemein** | Erscheinungsbild: System / Hell / Dunkel *(endlich angeschlossen)* |
| **Ausgabe** | Ordnername, Verhalten bei vorhandener Datei, Standard-Ziel |
| **Leistung** | Grafikkarte, **parallele Dateien** *(endlich angeschlossen)* |
| **Presets** | Alle Presets zurücksetzen |
| **Info** | Version, Engine (WebCodecs / FFmpeg), erkannte Encoder |

### 4.2 Interaktionsmodell

| Situation | Heute | Ziel |
|---|---|---|
| Preset ändern | sofort, global, unwiderruflich | **Entwurf** → `Speichern` / `Verwerfen`, Dirty-Anzeige, Esc fragt nach |
| Preset speichern mit fertigen Dateien | stiller Reset auf `ready` | Reset **angekündigt**: „N Dateien werden mit den neuen Einstellungen erneut konvertiert" |
| Während Konvertierung | Zahnrad offen, wirkt aber nicht | **alles gesperrt**, mit sichtbarem Grund („Während der Konvertierung gesperrt") |
| Stoppen | sofort | Bestätigung, wie bei „Löschen"/„Zurücksetzen" (Muster existiert bereits) |
| Lauf mit Fehlern beendet | primärer Button „Fertig" löscht alles | bei Fehlern: Zusammenfassung bleibt, `Erneut versuchen` primär, `Alle entfernen` sekundär |
| Doppelklick Datei | nichts | **Player + Werkzeuge** |
| Doppelklick Preset | Editor | bleibt Editor |
| Drehen/Beschnitt/Untertitel | im Preset (global) | **pro Datei** (Preset liefert nur noch Vorschlagswerte) |
| Teilmenge konvertieren | nicht möglich | Auswahl je Zeile, „N von M konvertieren" |

### 4.3 Datenmodell — der Kern

```ts
/** Fakten über eine einzelne Datei. Leer = Preset gilt unverändert. */
interface Adjustments {
  rotate?: 0 | 90 | 180 | 270;
  crop?: { left: number; top: number; width: number; height: number };  // Quellpixel
  trim?: { start?: number; end?: number };                              // Sekunden
  subtitles?: {
    mode: "auto" | "keep" | "burn" | "none";
    track?: number;                  // Index der Untertitelspur in der Quelle
    file?: SubtitleFileRef;          // extern hinzugefügte .srt/.vtt/.ass
  };
  videoTrack?: number;
  audioTrack?: number;
  maxWidth?: number;                 // Ausnahme vom Preset
  maxHeight?: number;
  enabled?: boolean;                 // false = Datei überspringen, ohne sie zu entfernen
}

interface Item {
  …                              // wie heute
  adjustments: Adjustments;      // NEU, Default {}
  selected?: boolean;            // NEU, Subset-Konvertieren
}

interface Preset {
  …                              // wie heute
  adjustDefaults?: Adjustments;  // NEU: Vorschlagswerte, die neue Dateien übernehmen
  // video.rotate / deinterlace / tenBit / hdrToSdr / scaling bleiben als Defaults,
  // die *wirksame* Instanz liegt aber pro Datei.
}
```

**Wichtig:** `Preset.adjustDefaults` macht die Migration schmerzfrei. Gespeicherte Presets
mit `video.rotate: 90` verlieren nichts — der Wert wird zum Vorschlag für neu hinzugefügte
Dateien. Mental: **„Preset = Vorschlag. Datei = Wahrheit."**

### 4.4 Ein Job-Modell, zwei Renderer

Das ist die wichtigste technische Maßnahme, und sie muss **vor** Electron passieren.

Heute bauen `engine.ts:buildVideo/buildAudio` und `ffmpeg.ts:buildFfmpegCommand` dieselbe
Logik zweimal — und sind bereits auseinandergedriftet (Untertitel: im FFmpeg-String ja,
in der Engine nein). Mit Per-Datei-Anpassungen verdoppelt sich das Risiko.

```
        Preset  +  MediaInfo  +  Adjustments
                        │
                 lib/job.ts  ★ neu
        resolveJob() — eine einzige Wahrheit:
        welcher Codec, welche Maße, welcher Beschnitt, welche Spur,
        kopieren oder kodieren, welche Filter, in welcher Reihenfolge
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
   ConversionVideoOptions    ffmpeg argv[]
   ConversionAudioOptions    (Desktop)
   (Web / Mediabunny)
```

Neu: `ffmpeg.ts` liefert ein **Argument-Array**, keinen zusammengefügten String.
Ausführen mit `spawn()` und einem Array ist sicher (kein Quoting, keine Pfade mit
Leerzeichen, die zerbrechen); der String für die Vorschau wird daraus mit einer
`shellQuote`-Funktion erzeugt. Das beheut nebenbei P2-11.

### 4.5 Plattform-Seam

```ts
interface MediaEngine {
  readonly kind: "webcodecs" | "ffmpeg";
  init(): Promise<Capabilities>;          // welche Codecs gehen wirklich?
  probe(src: SourceRef): Promise<ProbeResult>;
  convert(job: Job, sink: OutputSink, signal): Promise<ConvertResult>;
  preview(src: SourceRef): Promise<PreviewHandle>;   // abspielbar? sonst Fallback
  supported(codecs): Support;             // z. B. Untertitel einbrennen: web = nein
}

interface PlatformFS {
  pickFiles(): Promise<SourceRef[]>;
  pickFolder(): Promise<SourceRef[]>;
  fromDrop(payload): Promise<SourceRef[]>;
  planTargets(srcs, settings): Promise<Map<string, TargetRef>>;
  openTarget(t: TargetRef, name, ext): Promise<OutputSink | null>;
  reveal(t: TargetRef): void;             // „Im Ordner anzeigen" — Desktop
}

type TargetRef =                          // serialisierbar! kein FileSystemDirectoryHandle
  | { kind: "folder"; id: string; sub: string[] }
  | { kind: "download" };
```

`id` ist im Web ein Schlüssel in eine Handle-Map (in `fsa.ts`, bleibt dort), in der
Desktop-App ein Pfad. `SourceRef` ebenso: im Web `File` + Handle, in der Desktop-App ein Pfad.
`fsaSupported`/`engineSupported` als globale Flags verschwinden — ersetzt durch
`engine.supported(...)`, damit die UI **pro Fähigkeit** ehrlich sein kann statt global.

---

## Teil 5 — Phasenplan

Jede Phase ist in sich abgeschlossen, lässt `tsc` grün und das Produkt benutzbar.
Design-Sprache bleibt durchgehend unverändert: gleiche Tokens, gleiche `Group`/`Row`/`Btn`/
`Sheet`/`Segmented`/`Switch`/`Select`-Bausteine, gleiche Radien, gleiche Bewegung.

### Phase 0 · Fundament (½ Tag)
- `package.json`: Name `wandler`, Version `1.0.0`, Scripts `typecheck`, `test`, `build:web`,
  `dev:desktop`, `build:desktop`
- `README.md`: was es ist, wie man es startet, Architektur in 20 Zeilen
- `.gitignore`, Lizenz-Hinweis (Mediabunny MIT · FFmpeg LGPL/GPL — Entscheidung in Phase 5)
- **Vitest** für die pure Logik, bevor sie umgebaut wird:
  `planVideoSize`, `willCopyVideo/Audio`, `estimateOutputBytes`, `normalizePreset`,
  `withContainer`, `buildFfmpegCommand` (Snapshot-Tests)
- GitHub Actions: typecheck + test + build

### Phase 1 · Ehrlichkeit und Sperren (1–2 Tage)
Kleine, sofort spürbare Korrekturen — die Punkte, die du genannt hast, minus Datenmodell.
1. **Globaler Lock**: ein `locked`-Wert aus `useApp` (heute `busy`, wird explizit) sperrt
   Zahnrad, Einstellungen, Preset-Rail, Datei-Aktionen, Drop, Ziel — plus sichtbarer Grund
   (Tooltip/Hinweistext, gleiche Optik wie `notice`)
2. **Preset-Editor als Entwurf**: lokale Kopie, Dirty-Erkennung per Vergleich,
   Footer `Verwerfen | Speichern`, `Speichern` nur bei Änderungen primär, Esc/Klick auf den
   Hintergrund fragt bei Dirty-Status nach (Bestätigungsmuster aus `SettingsSheet` wiederverwenden)
3. `rearm()` **nur beim Speichern**, und angekündigt
4. **Stoppen mit Bestätigung** (`Footer`)
5. **Footer bei Fehlern**: `finished`-Logik so ändern, dass Fehler sichtbar bleiben;
   primär `Erneut versuchen`, sekundär `Alle entfernen`
6. **Tote Felder**: `appearance` → Thema-Wahl in Einstellungen (System/Hell/Dunkel),
   `concurrency` → „Parallele Dateien" in Einstellungen, beide wirklich angeschlossen
7. **Untertitel im Web ehrlich machen**: `keep`/`none` über `ConversionOptions.tracks`
   tatsächlich implementieren; `burn` im Web ausblenden/ausgrauen mit einem Satz Begründung

### Phase 2 · Datei-Inspektor (3–5 Tage) ★ das Herzstück
1. `Adjustments` in `types.ts`, `Item.adjustments`, Migration in `usePersistent`
2. `lib/job.ts`: `resolveJob(preset, info, adjustments)`; `engine.ts` konsumiert den Job
   (`crop`, `flip`, `trim.start`, `rotate`, Spurwahl über `tracks`/Callback-Form)
3. **Player-Sheet**: `<video>` + `URL.createObjectURL`, Tastatur (Leere, ←/→, Esc),
   Fallback bei nicht abspielbaren Formaten, `URL.revokeObjectURL` beim Schließen
4. **Drehen** mit Live-Vorschau (CSS-`transform` auf dem Player, keine Neuberechnung)
5. **Zuschneiden** mit ziehbarem Rechteck auf einem Standbild + Vorlagen; Vorschau per
   `object-fit`/`transform`
6. **Trimmen** mit zwei Griffen auf einem Zeitstreifen (einfach halten: keine Wellenform)
7. **Untertitel pro Datei**: Modus + Spurwahl, `.srt/.vtt` hinzufügen (Desktop vollständig,
   Web ehrlich begrenzt)
8. `Auf alle anwenden` / `Zurücksetzen` im Inspektor
9. Zeile: **Auswahl** für Subset-Konvertieren, Doppelklick-Hinweis, `Im Ordner anzeigen`
   (Desktop) nach Erfolg
10. `willCopyVideo/Audio` um `Adjustments` erweitern — sonst wird bei gedrehter Datei
    fälschlich kopiert

### Phase 3 · Ein Job-Modell, zwei Renderer (2–3 Tage)
1. `ffmpeg.ts` → `buildFfmpegArgs(job): string[]` + `renderCommand(args): string`
2. `job.ts` wird zur einzigen Quelle für Filter-Reihenfolge (Deinterlace → HDR → Drehen →
   Beschnitt → Skalieren → Untertitel), damit Web und Desktop **identisch** denken
3. Spurweises Mapping (`-map 0:v:N`) statt globalem `-map 0:v?` — behebt P2-11
4. Snapshot-Tests: gleiche Jobs müssen auf beiden Wegen dieselbe Semantik ergeben

### Phase 4 · Menüs neu (2–3 Tage)
1. Preset-Inspektor mit Sektions-Navigation (4.1), ein JSX-Baum statt zwei
2. Einstellungen gegliedert in fünf Sektionen
3. Preset-Verwaltung: Liste mit Umbenennen/Duplizieren/Löschen/Reihenfolge;
   Rail behält seine Optik, bekommt aber ein sauberes Verhalten bei vielen Presets
4. Durchgängige `title`/`aria`-Texte für gesperrte Zustände

### Phase 5 · Desktop / Electron (5–8 Tage)
1. `desktop/`: `main` (Fenster, IPC, FFmpeg-Lauf), `preload` (contextBridge,
   **`contextIsolation: true`, `nodeIntegration: false`**), Renderer bleibt der vorhandene
2. `MediaEngine`-Implementierung `ffmpeg`: `ffprobe -print_format json` für `probe`,
   `spawn` + `-progress pipe:1 -nostats` für Fortschritt, `SIGKILL` bei Abbruch,
   Two-Pass, `-movflags +faststart` echt (P2-12 entfällt)
3. FFmpeg-Binary: Version + Lizenz entscheiden (LGPL-Build ohne `libx264` vs. GPL-Build mit),
   gebündelt im Installer, nicht nachgeladen
4. Encoder-Wahrheit von FFmpeg statt WebGL: beim Start `-encoders` prüfen und daraus
   `Capabilities` + `HardwareInfo` ableiten (P2-10)
5. `PlatformFS`-Implementierung: native Dialoge, echte Pfade, `shell.showItemInFolder`,
   Zielplanung nach Pfad-Logik (kein IndexedDB nötig)
6. Windows-Integration: `win.setProgressBar`, Taskleisten-Overlay, Tray während Lauf,
   Dateizuordnungen, „Öffnen mit", Drag&Drop echter Pfade, `nativeTheme` für Hell/Dunkel,
   Einzelausgabe-Ordner, NSIS-Installer, Signatur, `electron-updater`
7. `electron-builder`-Konfiguration; `vite-plugin-singlefile` bleibt **nur** für den Web-Build

### Was wir ausdrücklich nicht tun
- kein Redesign, keine neuen Farben, keine neue Typo, keine neue Iconsprache
- kein Schnittprogramm, keine Timeline, keine Effekte, kein Color-Grading
- kein `ffmpeg.wasm` im Web, außer du entscheidest es in Frage 3 anders
- kein Framework-Wechsel, kein State-Management-Library — `useApp` reicht, wenn es
  aufgeteilt wird (`usePresets`, `useItems`, `useConversion`)
- kein Konto, keine Cloud, kein Upload

---

## Teil 6 — Entscheidungen (geklärt am 2026-10-12)

Die vier offenen Fragen sind beantwortet. Damit ist der Plan verbindlich:

| Frage | Entscheidung | Konsequenz für den Plan |
|---|---|---|
| **Was wandert von Preset → Datei?** | Drehen · Zuschneiden · **Trimmen** · Untertitel | `Adjustments` bekommt `rotate`, `crop`, `trim`, `subtitles`. **Keine** Auflösungs-/Qualitäts-Overrides, **keine** Spurwahl, **kein** Ziel/Dateiname pro Datei. `Adjustments` bleibt entsprechend schlank. |
| **Speicher-Semantik des Presets** | Entwurf → `Speichern` / `Verwerfen` | Kein „Als neues Preset sichern", kein temporäres „Nur für diese Dateien". Ein Draft, zwei Ausgänge. Neues Preset entsteht ebenfalls erst beim Speichern. |
| **Untertitel im Web** | Untertitel **nur** in der Desktop-App | Die Untertitel-Zeile verschwindet im Web vollständig aus dem Preset-Editor. Das Feld `Preset.subtitles` bleibt im Modell (Desktop), die Engine-Fähigkeit wird über `Capabilities.subtitles` abgefragt. `keep`/`none` via `ConversionOptions.tracks` entfällt damit — im Web gilt der Mediabunny-Standard. |
| **Reihenfolge Electron** | Erst Web-UX (Phase 1–4), dann Electron | Phase 5 bleibt am Ende. Der Plattform-Seam (`job.ts`, `MediaEngine`, `PlatformFS`) wird trotzdem in Phase 2/3 sauber angelegt — als Vorbereitung, nicht als Vorgriff. |

**Arbeitsreihenfolge:** Phase 0 → 1 → **4a (vorgezogen)** → 2 → 3 → 4b → 5.

### Nachtrag: Preset-Aufräumarbeit (vorgezogen aus Phase 4)

Auf Wunsch vor Phase 2 erledigt, weil der Preset-Editor die am häufigsten benutzte
Oberfläche ist:

- **„Einfach | Profi" ist weg.** Der Schalter hatte zwei getrennte JSX-Bäume zur Folge
  (563 Zeilen) und zwei Antworten auf dieselbe Frage. Ersetzt durch **Kategorien** mit
  linker Navigation: `Format · Video · Bild · Ton · Experten · Befehl`.
- **Kategorien erscheinen nur, wenn sie etwas bewirken können.** Audio-Container →
  `Format · Ton · Befehl`. Videocodec „Nicht neu kodieren" → die Kategorien `Bild` und
  `Experten` fallen weg, dafür erklärt ein Hinweistext, warum. Das ist der eigentliche
  Ordnungsgewinn: nicht weniger Regler, sondern **keine irrelevanten**.
- **`Zurücksetzen` im Editor ist weg.** (Der globale Reset in den Einstellungen bleibt —
  er ist die Notausstieg-Luke, nicht Teil der Bearbeitung.)
- **Fußzeile: `Abbrechen` · `Fertig` unten rechts.** `Fertig` speichert, `Abbrechen` nicht.
- **Fester Rahmen** (680 × 680 px, auf kleinen Fenstern gedeckelt): Die Größe bleibt
  ruhig, wenn die Kategorie wechselt. Nur der Inhalt scrollt.
- **Änderungs-Haken pro Wert** (iTunes-Muster) statt einer Sammel-Meldung und statt
  einer Rückfrage beim Schließen: Jeder der 32 Werte, der vom gespeicherten Stand
  abweicht, trägt einen kleinen **grünen Haken**. Beim Überfahren wird er zu einem
  **orangen Undo-Symbol**, ein Klick stellt genau diesen Wert zurück — nicht das Preset.
  `Abbrechen` bleibt der grobe Weg, der Haken der feine.
  Die Auflösungs-Zeile richtet sich nach der *Stufe*, nicht nach Breite/Höhe,
  damit eine geänderte Breite nicht zwei Haken meldet.
- **Der Regler-Knopf auf der Preset-Karte ist weg, dafür drei Punkte.** Menü:
  `Einstellungen · Duplizieren · Löschen`. Löschen wandert aus dem Editor hierher —
  es betrifft die Karte, nicht den Entwurf. Bestätigung in zwei Schritten,
  das letzte Preset ist geschützt.
- Beide Auflösungen (Auswahl *und* Breite/Höhe-Felder) sind zu **einem** Bedienelement
  zusammengeführt: `Auflösung` mit „Eigene Größe" als einem von acht Werten.

Technisch dabei entstanden und ab jetzt wiederverwendbar:
`Menu` (rendert in ein Portal und richtet sich am Auslöser aus — der Preset-Rail scrollt
horizontal, ein normales absolutes Menü wäre abgeschnitten worden) und `MenuItem`
(zuvor privat im Footer). `SlidersGlyph` wurde durch `DotsGlyph` ersetzt.

### Nachtrag: Phase 2 + 3 umgesetzt

**Drehen ist aus dem Preset ausgezogen.** Es war dort nie richtig aufgehoben: ein Preset
beschreibt ein Zielformat, „diese Aufnahme steht schief" beschreibt eine Datei.
`VideoSettings.rotate` ist entfernt, gespeicherte Presets verlieren das Feld beim Laden
stillschweigend — es gibt keine Nutzer, die es vermissen könnten, und ein totes Feld
mitzuschleppen war genau die Krankheit, die dieses Audit beschreibt.

**Neu: `src/components/FileInspector.tsx`.** Doppelklick auf eine Dateizeile (oder Klick
auf ihr Vorschaubild) öffnet sie. Aufbau wie der Preset-Editor, damit beide Fenster
dieselbe Sprache sprechen: linker Werkzeugwechsel `Wiedergabe · Drehen · Zuschneiden ·
Schneiden`, rechts die Bühne, darunter Laufwerk und Werkzeug, ganz unten
`Abbrechen · Fertig`. Auch hier das Haken-Muster: jeder geänderte Wert einzeln
zurückstellbar, in der Werkzeugleiste markiert ein grüner Punkt, wo etwas abweicht.
`Auf alle anwenden` überträgt den Entwurf auf jede Datei mit Bild.

Geometrie der Vorschau: Mediabunny dreht erst, beschneidet dann, skaliert zuletzt. Die
Bühne baut denselben Raum nach — außen eine **achsenparallele** Box in der Größe nach der
Drehung, darin das per CSS gedrehte Bild in Quellgröße, darüber das Beschnitt-Rechteck.
Das Rechteck liegt dadurch immer waagerecht, auch wenn die Aufnahme um 90° gedreht ist.
Kann der Browser das Format nicht abspielen, fällt die Bühne auf das Vorschaubild zurück
und sagt das offen — kein stummer schwarzer Kasten.

**`src/lib/job.ts` ist der Seam (Phase 3 vorgezogen).** `resolveJob(preset, info, adj)`
rechnet Drehung, Beschnitt, Schnitt, Zielgröße und Kopier-Entscheidung **einmal** aus.
`engine.ts` macht daraus Mediabunny-Optionen, `ffmpeg.ts` ein Argument-Array — vorher
bauten beide dieselbe Logik selbst und drifteten auseinander. Die Größenschätzung zog
mit um, weil sie den aufgelösten Auftrag braucht: Sie rechnet jetzt mit der geschnittenen
Dauer und der beschnittenen Fläche.

Zwei Regeln, die beim Schreiben der Tests entstanden sind:

- **Gerade Zahlen runden ab.** `even(1919)` ergibt 1918, nicht 1920 — Aufrunden ließ einen
  Beschnitt über das Bild hinauswachsen. Positionen haben kein Mindestmaß, Größen schon.
- **Maßgeblich ist, was übrig bleibt.** Ein Beschnitt, der aufs ganze Bild fällt, und ein
  Schnitt, der die ganze Datei behält, sind keine Änderung. Ohne diese Regel verbot ein
  wirkungsloser Rahmen das verlustfreie Kopieren.

**`npm test`** — 42 Prüfungen der reinen Logik, ohne neues Framework: gebündelt mit
esbuild (liegt im Projekt), ausgeführt mit Node. `test/` steht im `tsconfig.include`,
damit `npm run typecheck` auch den Test prüft; esbuild allein tut das nicht.

**Weiter offen:** P2-11 (das `-map` ist unverändert global, nur die Filterkette ist jetzt
geordnet), P2-12, P2-15, P2-10. Der Seam deckt die Logik ab; `MediaEngine` und
`PlatformFS` als austauschbare Schnittstellen fehlen noch und kommen mit Phase 5.

### Nachtrag: Korrekturen nach dem ersten Ausprobieren

Rückmeldungen aus der Benutzung, alle umgesetzt:

- **Der globale Preset-Reset in den Einstellungen ist weg.** Damit ist die Entscheidung
  aus dem Nachtrag oben („der globale Reset bleibt als Notausstieg-Luke") überholt.
  Ein Knopf, der die eigene Arbeit löscht, war keine Luke, sondern eine Falle —
  zumal es `Duplizieren` gibt und jedes Preset einzeln löschbar ist. Die Gruppe
  `Zurücksetzen` hatte damit noch genau eine Zeile — eine Überschrift für einen einzigen
  Eintrag ist keine Gliederung. `Gemerkte Ordner → Vergessen` ist zur Gruppe `Ausgabe`
  gewandert, wo es um Ordner geht, und die Gruppe ist aufgelöst. Die Einstellungen haben
  jetzt drei Abschnitte: `Allgemein · Leistung · Ausgabe`.
- **Die Kategorien-Leiste ist breiter** (152 → 188 px, innen `px-3`), im Preset-Editor
  und im Datei-Inspektor gleich. Sie trägt die Navigation und war zu schüchtern dafür.
- **Der Änderungs-Haken ist jetzt ein voller Kreis** in Grün mit weißem Haken; beim
  Überfahren wird er orange mit weißem Undo-Pfeil. Damit ist er als Knopf erkennbar —
  die vorige Fassung (zart getönt mit Ring) sah aus wie ein Zustand, nicht wie eine
  Einladung. Es ist derselbe Auftritt wie das Fertig-Abzeichen in der Dateiliste.
- **Gradzahlen beim Drehen sind weg.** Der Umschalter `0° · 90° · 180° · 270°` war
  doppelt gemoppelt mit den beiden Drehknöpfen und hat irritiert. Geblieben sind
  ⟲ ⟳ und das Ergebnismaß in Pixeln — das ist die Folge, die interessiert.
- **Hochkante Bilder liefen beim Drehen aus dem Rahmen.** Zwei Ursachen, beide behoben:
  die Bühne maß mit `useEffect` *nach* dem Malen, also renderte ein Bild mit neuer
  Größe und altem Maßstab; und ein `overflow-hidden` um das gedrehte Bild schnitt ab,
  wo nichts zu schneiden war. Das Bild wird jetzt **in Prozent des Rahmens** angegeben
  statt in Pixeln aus dem Maßstab und ist damit rechnerisch immer eingeschrieben —
  auch in dem Moment, in dem der Maßstab hinterherhinkt. Gemessen wird mit
  `useLayoutEffect`, also vor dem ersten Bild.
- **Die Zeitleiste nennt die Zeit am Zeiger.** Beim Überfahren und beim Ziehen eines
  Griffs erscheint die Stelle als kleine Marke über der Leiste. Ein Lineal ohne
  Zahlen war sie vorher.
- **Presets lassen sich umsortieren, indem man sie zieht.** Mit Zeiger-Ereignissen,
  nicht mit HTML5-Drag-and-Drop: natives Ziehen hätte dem Klick (auswählen), dem
  Doppelklick (bearbeiten) und dem Drei-Punkte-Menü in derselben Karte in die Quere
  gegriffen. Die Karte folgt dem Zeiger, die anderen rücken sichtbar aus dem Weg,
  erst beim Loslassen wird gespeichert. Tastatur: `Strg/⌘ + ←/→`. Die Rechnung dafür
  liegt als reine Funktion in `lib/order.ts` (`slotShift`, `moveTo`) und ist getestet —
  Umsortieren ist genau die Art Logik, die still falsch wird.

### Nachtrag: Feinschliff nach dem zweiten Ausprobieren

- **Schnellstart funktioniert jetzt in jeder Größe (P2-12).** `in-memory` hält die
  fertige Datei bis zum Abschluss im Arbeitsspeicher; ab etwa einem Gigabyte wurde
  Schnellstart deshalb still fallengelassen — der Schalter versprach etwas, das nicht
  passierte. Jetzt gilt: bis 1 GB `in-memory`, darüber `fragmented`. Fragmentiertes
  MP4 schreibt die Metadaten ebenfalls nach vorn, braucht aber keinen Speicher
  proportional zur Dateigröße. Die Preset-Zeile sagt das in einem Satz.
- **Kommentare gehören nicht in JSX-Kinder.** Ein `/* … */` zwischen zwei Elementen
  ist kein Kommentar, sondern Text — er stand sichtbar im Drehen-Reiter. Entfernt,
  und alle Komponenten daraufhin geprüft. Begleitprosa ohne Handlungswert ist
  ebenfalls raus: Der Wiedergabe-Reiter zeigt jetzt schlicht keinen Text mehr, die
  Bühne ist die Wiedergabe. Geblieben sind Sätze, die einen Zustand melden
  (Browser spielt das Format nicht) oder eine Abwesenheit begründen (Tondatei) —
  dieselbe Familie wie die Hinweistexte im Preset-Editor.
- **Ziehen auf der Zeitleiste führt das Bild mit.** Anhalten, Stelle zeigen,
  weiterspielen — beim Laufkopf und bei den Schnittgriffen, in jedem Werkzeug.
  Ein Lineal, dessen Bild nicht mitläuft, ist keins.
- **Presets gleiten, sie springen nicht.** Nach dem Loslassen folgt die Karte nicht
  mehr dem Zeiger, sondern fährt in ihrer eigenen Bewegung in die Lücke
  (`cubic-bezier(0.32, 0.72, 0, 1)`, 340 ms); erst danach wird die Reihenfolge
  gespeichert. Die Kurve ist die der App — Segmented und Bühne nutzen sie schon.
- **Die ausgewählte Karte färbt sich.** Bisher trug nur ein 2px-Rand die Farbe, die
  Fläche blieb weiß. Jetzt mischt sich das Akzentblau mit 11 % in die Kartenfläche,
  in Hell wie Dunkel. Auswahl ist ein Zustand der Karte, nicht ihrer Umrandung.
- **Der Zeiger ist ein Zeiger.** `cursor-grab` auf jeder Karte suggerierte Dauerziehen;
  die Faust erscheint nur noch, während tatsächlich gezogen wird. Sonst zeigt die
  Karte den Zeiger wie jedes anklickbare Element.

### Nachtrag: Subset-Konvertieren (P2-15)

Zwanzig Dateien in der Liste, drei davon wollen neu — bisher hieß das: alles oder
nichts. Jetzt trägt eine Datei eine Auswahl: `⌘/Strg-Klick` markiert, `⌘/Strg + A`
markiert alle bereiten, `Esc` hebt auf. Eine markierte Zeile mischt das Akzentblau
in ihre Fläche und trägt ein Häkchen an der Vorschau — derselbe Auftritt wie die
ausgewählte Preset-Karte, damit Auswahl in der App überall gleich aussieht.

Wichtig ist, was die Auswahl *nicht* ist: kein dauerhafter Modus und kein Filter.
Ist sie leer, gilt der Lauf allen Dateien wie zuvor. Sobald sie gefüllt ist, meinen
**alle** Zahlen im Footer genau die Markierten — Dauer, Schätzung, Knopfbeschriftung
(`Auswahl konvertieren`, daneben `Auswahl aufheben`). Eine Auswahl, die nur den Knopf
beträfe, wäre eine Lüge über den Rest der Zeile.

Offen bleibt die Entdeckbarkeit: Der Weg führt über einen Tooltip und das README,
nicht über ein sichtbares Bedienelement. Ein Kontextmenü auf der Zeile wäre der
sichtbare Weg; das ist bewusst gespart, bis klar ist, ob die Auswahl im Alltag trägt.

### Nachtrag: Lauf sichtbar, Auswahl körperlich, Desktop geplant

- **Der Fertig-Haken sitzt rechts.** Er lag als Overlay auf der Vorschau links und
  konkurrierte dort mit dem Auswahl-Häkchen. Jetzt steht er in der rechten Spalte,
  wo auch Fortschritt und Schätzung wohnen — der Zustand einer Datei gehört an
  ein Ende der Zeile, nicht über ihr Bild.
- **Die ausgewählte Preset-Karte ist ein Körper.** Volles Blau mit Licht von oben
  und Schatten nach unten, weiße Schrift, weißer Ring um das Icon. Die elfprozentige
  Tönung davor war zu schüchtern, um „hier wird konvertiert" zu sagen.
- **Das Springen beim Einsortieren war eine Transition zu viel.** Beim Einsortieren
  wechseln DOM-Platz und Transform im selben Zug; die Klassen-Transition animierte
  den Transform-Rest sichtbar rückwärts. Ein Frame ohne Transitionen beim Einsortieren
  beendet das. Die Karte gleitet vorher in ihre Lücke, danach steht sie.
- **Dateien laden hinter einem eigenen Fenster.** Solange etwas gelesen wird, liegt
  ein nicht schließbares Overlay über der App: Spinner, Zahl, ein Satz. Ein Zustand,
  in dem nichts anderes geht, soll nicht aussehen wie ein Zustand, in dem man klicken kann.
- **Während ein Lauf arbeitet, laufen die Dateinamen durch.** In der Footer-Zeile
  wechseln die Namen der gerade konvertierten Dateien zwischen „x von y" links und
  der Restzeit rechts. Der Lauf ist damit auch lesbar, wenn das Fenster schmal ist.
- **Phase 5 ist geplant, nicht nur benannt.** `docs/DESKTOP-PLAN.md` beschreibt Fenster
  ohne Windows-Optik mit eigenen, leicht runden Kanten, die Titelleiste aus der
  bestehenden Kopfzeile (die Klassen `drag`/`no-drag` liegen seit Phase 0 bereit),
  den Taskleisten-Fortschritt, FFmpeg-Erkennung vor Download statt Bündelung, und die
  Reihenfolge der Umsetzung. Das Workflow `.github/workflows/desktop.yml` baut den
  NSIS-Installer auf `windows-latest` — bewusst ohne FFmpeg im Artefakt.

---

## Teil 7 — Offene Punkte für später

Nicht eilig, aber vor Phase 5 zu entscheiden:

- **FFmpeg-Lizenz:** geklärt am 2026-10-14 — GPL-Build, siehe `docs/DESKTOP-PLAN.md` §8.
- **Distribution:** geklärt am 2026-10-14 — erst unsigniert (SmartScreen-Warnung als
  bewusster Preis), Signatur folgt mit Zertifikat. Update-Kanal und Store bleiben offen.
- **Presets bei vielen Einträgen:** Rail bleibt bis ca. 6 Presets; danach Grid-Picker.
  Wird in Phase 4 entschieden, wenn die Verwaltung steht.
- **Nachtrag 2026-10-14:** Der Plattform-Seam (P2-16) ist gebaut — `src/lib/platform.ts`
  mit `PlatformFS`, `MediaEngine`, `OutputSink` und `chooseName`. Was Phase 5 noch schuldet:
  die Desktop-Implementierung selbst und eine Hardware-Wahrheit, die nicht von WebGL kommt.

---

## Anhang · Befund-Index

| # | Priorität | Befund | Ort | Stand |
|---|---|---|---|---|
| 1 | P0 | Untertitel-Einstellung ohne Wirkung im Web | `types.ts:61`, `engine.ts` (fehlt), `ffmpeg.ts:72,113,182` | behoben (Phase 1) |
| 2 | P0 | Preset-Änderungen sofort/global/unwiderruflich, `rearm()` zerstört Fertig-Status | `useApp.ts:90-116`, `PresetEditor.tsx:100-102` | behoben (Phase 1) |
| 3 | P0 | Zahnrad/Einstellungen während Konvertierung offen, aber wirkungslos | `App.tsx:83,108-114`, `useApp.ts:343` | behoben (Phase 1) |
| 4 | P1 | `concurrency` und `appearance` tot | `types.ts:70-71`, `storage.ts:8-9`, `useApp.ts:324` | behoben (Phase 1) |
| 5 | P1 | Engine kann `crop`/`flip`/`trim.start`/`process` — ungenutzt | `engine.ts:332-356` | behoben (Phase 2/3) |
| 6 | P1 | Drehen/Beschnitt/HDR/10 Bit/Deinterlace im Preset statt pro Datei | `types.ts:19-45` | behoben (Phase 2) |
| 7 | P1 | Kein Abspielen, kein Doppelklick auf Dateien | `FileRow.tsx` | behoben (Phase 2) |
| 8 | P1 | „Fertig" löscht Fehler samt Begründung | `Footer.tsx:252,377-380` | behoben (Phase 1) |
| 9 | P1 | „Stoppen" ohne Bestätigung | `Footer.tsx:373` | behoben (Phase 1) |
| 10 | P2 | GPU-Erkennung über deprecated WebGL-API | `hardware.ts:12-18` | offen |
| 11 | P2 | `-map 0:v?` mit globalem `-vf` bricht bei mehreren Videospuren | `ffmpeg.ts:71,114` | behoben — eine Bild-, eine Tonspur |
| 12 | P2 | Schnellstart ab 1,2 GB stillschweigend weg | `engine.ts:432-433` | behoben |
| 13 | P2 | Preset-Editor: 563 Zeilen, zwei JSX-Bäume, endloser Profi-Scroll | `PresetEditor.tsx` | behoben (Phase 4a) |
| 14 | P2 | Preset-Rail skaliert nicht, Verwaltung nur im Editor | `PresetBar.tsx:126` | teilweise — Menü auf der Karte, Grid-Picker offen |
| 15 | P2 | Kein Subset-Konvertieren | `useApp.ts:275` | behoben — Auswahl per ⌘/Strg-Klick |
| 16 | P2 | Kein Plattform-Seam; `Target` nicht serialisierbar | `platform.ts`, `fsa.ts`, `engine.ts` | behoben — Naht steht (`webFS`/`webEngine`, `Target` als JSON); Desktop-Implementierung folgt in Phase 5, `hardware.ts` bleibt offen (P2-10) |
| 17 | P2 | Repo-Hygiene: Name, Version, README, Tests, Lint, CI, Lizenz | `package.json`, `README.md` | teilweise — Tests ja, Lint/CI nein |

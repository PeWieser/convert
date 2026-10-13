# Wandler für Windows — Umsetzungsplan (Phase 5)

Dieses Dokument ist der Bauplan, nicht die Umsetzung. Es steht hier, damit die
Reihenfolge der Arbeit und jede Entscheidung nachlesbar ist, bevor Code entsteht.

Ziel: dieselbe Oberfläche, dieselbe Logik, andere Engine. Die Web-App bleibt das
Referenzprodukt; die Desktop-App tauscht unten drei Dateien aus und oben nichts.

---

## 1 · Was wiederverwendet wird, was ersetzt wird

`src/lib/job.ts` ist bereits der Seam: `resolveJob(preset, info, adj)` sagt, was mit
einer Datei passiert. Beide Welten lesen daraus.

| Schicht | Web | Windows |
|---|---|---|
| Auftrag | `lib/job.ts` | **dieselbe Datei** |
| Engine | `lib/engine.ts` (Mediabunny) | `desktop/engine-ffmpeg.ts` (Prozessaufruf) |
| Dateizugriff | `lib/fsa.ts` (File System Access) | `desktop/fs-node.ts` (`node:fs`) |
| Hardware-Wahrheit | `lib/hardware.ts` (WebGL, fragil — P2-10) | `ffmpeg -encoders` (die echte Liste) |
| Befehl | `lib/ffmpeg.ts` (Vorschau-String) | `desktop/ffmpeg-args.ts` (**Argument-Array**, kein Shell-String) |

Wichtig und leicht falsch: Der Desktop braucht ein **Array** von Argumenten, nie einen
Shell-String. Dateinamen mit Leerzeichen oder `&` sind sonst ein Sicherheitsloch und ein
Fehler zugleich. Der Vorschau-String in `lib/ffmpeg.ts` wird daraus abgeleitet
(join mit `shellQuote`), nicht umgekehrt.

Gebaut am 2026-10-14 in `src/lib/platform.ts`: zwei schmale Schnittstellen, damit der
Renderer nie weiß, wo er läuft. Die Web-Seite liefert `webFS` (`lib/fsa.ts`) und
`webEngine` (`lib/engine.ts`); `useApp.ts` kennt nur noch diese beiden Namen.

```ts
interface MediaEngine {
  init(): Promise<void>;
  probe(src: SourceFile): Promise<ProbeResult>;
  convert(req: ConvertRequest, onProgress: (f: number) => void): Promise<ConvertResult>;
  isCanceled(err: unknown): boolean;
}
interface PlatformFS {
  pickFiles(): Promise<File[]>;
  pickFolder(): Promise<string | null>;
  collectFromDrop(dt: DataTransfer): Promise<SourceFile[]>;
  planTargets(sources: SourceFile[], settings: Settings): Promise<Target[]>;
  open(target: Target, source: SourceFile, ext: string, settings: Settings): Promise<OutputSink | null>;
  chooseCustomDestination(): Promise<boolean>;
  forgetFolders(): void;
}
```

`Target` ist jetzt reines JSON — `{ kind: "download" }` oder
`{ kind: "folder", folder: { kind, id }, sub: string[] }` — und geht damit unverändert über
Electron-IPC (Befund 16 erledigt). Lebende Handles bleiben im Renderer: `fsa.ts` führt ein
Register (`internFolder` / `resolveFolder`), der Desktop liefert unter derselben `id` einen
Pfad. Die Namensregel (`skip` / `number` / `overwrite`, Quelle nie überschreiben) steht als
reine Funktion `chooseName` in `platform.ts` und ist getestet — beide Welten rufen sie auf,
nur `exists` kommt woanders her. `OutputSink` versteckt, wohin die Bytes fließen: im Web ein
`FileSystemWritableFileStream`, auf dem Desktop ein Schreibstrom auf eine Datei.

---

## 2 · Fenster: keine Windows-Optik, eigene Kanten

- `frame: false`, `transparent: true`. Windows malt nichts an das Fenster; die App malt
  sich selbst. Damit funktionieren die runden Kanten auch auf Windows 10, wo DWM keine
  Ecken rundet: Die Wurzel bekommt `border-radius: 10px` („nur leicht"), der Body ist
  durchsichtig, ein weicher Schatten sitzt unter der Fläche.
- Die bestehende Kopfzeile wird zur Titelleiste: Sie trägt bereits die Klassen `drag`
  und `no-drag` (`src/index.css:127`), die heute im Browser wirkungslos sind und im
  Desktop genau das tun, wofür sie angelegt wurden. Links kommen drei Knöpfe in
  App-Optik dazu — klein, ruhig, wie bei iTunes: **Zuklappen · Vollbild · Schließen**,
  gezeichnet wie das Zahnrad, nicht wie Windows-Kacheln.
- Doppelklick auf die Leiste = Vollbild wechseln; `Esc` schließt weiterhin nur Fenster
  innerhalb der App, nie die App.
- Die Knöpfe rufen über IPC `win.minimize() / maximize() / close()`. Der Renderer bekommt
  sonst nichts vom Fenster mit — keine `window`-APIs in Komponenten.

## 3 · Taskleiste zeigt den Stand

Während ein Lauf arbeitet: `win.setProgressBar(fraction)` — der grüne Balken im
Taskknopf, derselbe Wert wie der Fortschritt im Footer. Bei `fraction >= 1` kurz
`"normal"`, dann `"none"`; schlägt ein Lauf fehl, einmal `"error"` (roter Balken), damit
der Stand im Hintergrundfenster sichtbar bleibt. Zusätzlich `setOverlayIcon` mit einer
zur Laufzeit gerenderten Prozent-Plakette (Canvas → `nativeImage`), abgeschaltet sobald
nichts läuft. Beide Aufrufe leben im Main-Prozess; der Renderer schickt nur Zahlen.

## 4 · FFmpeg: erst suchen, dann laden, nie bündeln

FFmpeg liegt **nicht** im Installer und nicht im Repo. Reihenfolge, sowohl im Installer
als auch zur Laufzeit:

1. **Erkennen.** `FFMPEG_PATH` aus den Einstellungen → `%LOCALAPPDATA%\Wandler\ffmpeg\bin`
   → `where ffmpeg` (PATH) → bekannte Orte (Chocolatey, Scoop, Gyan-Install). Treffer:
   `ffmpeg -version` ausführen und die Zeile lesen (Build, Lizenz, Encoder).
2. **Fehlt es: laden.** Im Installer als eigener NSIS-Abschnitt *nach* der Erkennung,
   zur Laufzeit als fallback mit Fortschrittsbalken und klarer Meldung. Quelle ist ein
   fester Release-Build (siehe offene Entscheidung unten), geprüft gegen eine hinterlegte
   SHA-256-Prüfsumme. Entpackt nach `%LOCALAPPDATA%\Wandler\ffmpeg`.
3. **Sagen, was gilt.** Die Einstellungen zeigen den gefundenen Pfad, die Build-Zeile und
   die Encoder-Liste. `hardware.ts` wird dadurch endlich wahr: `-encoders` sagt, ob NVENC,
   AMF oder Quick Sync da sind — nicht eine deprecated WebGL-API (P2-10).

Warum nicht bündeln: Viele haben FFmpeg bereits; ein zweites, veraltetes FFmpeg im
Programmordner ist Ballast und ein Update-Problem. Warum die Prüfsumme: Ein geladener
Encoder ist Vertrauenscode; ohne Summe wäre der Installer ein Man-in-the-middle-Ziel.

## 5 · Fortschritt und Reparatur aus ffmpeg heraus

`ffmpeg -progress pipe:1 -nostats` liefert zeilenweise `out_time_ms`, `speed`, `frame`.
Der Main-Prozess liest stderr, rechnet auf den Bruchteil aus `job.duration` und schickt
IPC-Ereignisse. Die Reparatur-Kaskade der Web-Engine (`engine.ts:convert`) bekommt ihr
Gegenstück: Exit-Code ≠ 0 → Ausgabe prüfen (ist die Datei lesbar, wie lang?) → teilweiser
Erfolg mit ehrlicher Meldung, genau wie im Web. Kein stummes „fehlgeschlagen".

## 6 · Installer und CI

- `desktop/` mit eigener `package.json` (electron, electron-builder), `electron-builder.yml`:
  Ziel **NSIS**, ein exe-Installer, Sprache Deutsch+Englisch, kein Startmenü-Zwang.
- NSIS-Skript (`desktop/installer.nsh`): Abschnitt „FFmpeg prüfen": `nsExec::ExecToStack
  'ffmpeg -version'` und Pfadtests; nur wenn nichts gefunden wird, lädt `inetc::get` den
  Build und entpackt ihn. Scheitert der Download, installiert die App trotzdem und meldet
  sich beim ersten Start mit demselben Angebot — kein toter Erststart ohne Netz.
- **GitHub Actions** (`.github/workflows/desktop.yml`): `windows-latest`, `npm ci`,
  `npm run build` (der Web-Bundle ist der Renderer-Inhalt), dann electron-builder,
  Artefakt hochladen und an ein Release hängen. Ausgelöst durch Tags `desktop-v*` und
  manuell. Kein FFmpeg im Artefakt — das lädt der Installer.
- Signatur: offen, siehe unten. Unsigniert heißt SmartScreen-Warnung; das ist eine
  Produktentscheidung, keine technische.

## 7 · Reihenfolge der Umsetzung

1. ~~`Target` serialisierbar machen, `MediaEngine`/`PlatformFS` als Typen einführen, Web auf
   die Schnittstellen umstellen~~ — **erledigt am 2026-10-14**: `lib/platform.ts`,
   `webFS`/`webEngine`, Verhalten identisch, 64/64 Prüfungen grün.
2. `desktop/`-Gerüst: Fenster, Titelleiste, Taskleisten-Fortschritt, IPC-Vertrag.
3. `ffmpeg-args.ts` + `engine-ffmpeg.ts` mit Fortschritt und Reparatur; `-encoders` als
   Hardware-Wahrheit.
4. Installer + NSIS-FFmpeg-Abschnitt + Workflow; erster signierter oder unsignierter Build.
5. Gegenprüfen: dieselbe Datei, Web und Desktop, identischer Job — dieselbe Größe ± Codec.

## 8 · Entscheidungen (geklärt am 2026-10-14)

- **FFmpeg-Build: GPL.** Vollständige Encoderliste, damit jedes Preset der Web-Version auch
  auf Windows wirklich funktioniert — ein LGPL-Build ohne `libx264` hätte das H.264-Preset
  zur Lüge gemacht. Quelle: BtbN `ffmpeg-master-latest-win64-gpl.zip`, mit gepinntem
  SHA-256 im Manifest. Die App selbst bleibt Lizenz-neutral (FFmpeg läuft als getrennter
  Prozess); die GPL-Pflichten treffen den geladenen Build, und der wird mit Quelle,
  Version und Lizenztext im Installer und im „Über"-Dialog ausgewiesen.
- **Signatur: erst unsigniert.** Die SmartScreen-Warnung ist der bewusste Preis für einen
  frühen Test-Build; Zertifikat oder Azure Trusted Signing folgt, sobald die App
  veröffentlicht wird. Nie gelöst wird sie durch Weglassen der Meldung: Der Installer sagt
  beim ersten Start, was Windows anzeigt und warum.
- **Windows 10 und 11.** Die App malt Kanten, Rundung und Schatten selbst, weil der DWM auf
  Windows 10 beides nicht hergibt. Kosten: ein eigenes Rahmen-Layout (siehe §2), Gewinn: ein
  Fenster, das auf beiden Versionen gleich aussieht.

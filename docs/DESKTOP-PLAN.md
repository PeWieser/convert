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

Neu in `src/lib/types.ts`: zwei schmale Schnittstellen, damit der Renderer nie weiß,
wo er läuft.

```ts
interface MediaEngine {
  probe(src: SourceRef): Promise<MediaInfo>;
  convert(job: Job, target: TargetRef, onProgress: (f: number) => void, signal: AbortSignal): Promise<ConvertResult>;
}
interface PlatformFS {
  pickSources(): Promise<SourceRef[]>;
  planTarget(src: SourceRef, settings: Settings): Promise<TargetRef>;
  open(target: TargetRef): Promise<Writable>;
}
```

`Target` enthält heute einen `FileSystemDirectoryHandle` (Befund 16) — der ist nicht
serialisierbar und gehört raus. Ersetzt durch `{ dir: string; name: string }`, das beide
Welten verstehen (Web: Handle-Map im Renderer; Desktop: Pfad).

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

1. `Target` serialisierbar machen, `MediaEngine`/`PlatformFS` als Typen einführen, Web auf
   die Schnittstellen umstellen (Verhalten identisch, Tests grün).
2. `desktop/`-Gerüst: Fenster, Titelleiste, Taskleisten-Fortschritt, IPC-Vertrag.
3. `ffmpeg-args.ts` + `engine-ffmpeg.ts` mit Fortschritt und Reparatur; `-encoders` als
   Hardware-Wahrheit.
4. Installer + NSIS-FFmpeg-Abschnitt + Workflow; erster signierter oder unsignierter Build.
5. Gegenprüfen: dieselbe Datei, Web und Desktop, identischer Job — dieselbe Größe ± Codec.

## 8 · Offene Entscheidungen

- **FFmpeg-Build:** LGPL (kein `libx264`, also kein H.264-Ziel aus x264 — dafür `libsvtav1`,
  `libvpx`, native Encoder) oder GPL (volle Encoderliste). Da die App FFmpeg nur als
  getrennten Prozess ruft, bleibt sie selbst Lizenz-neutral; aber der *geladene* Build
  bestimmt, welche Presets auf Windows funktionieren. Ein LGPL-Build macht das
  H.264-Preset zur Lüge.
- **Signatur:** eigenes Zertifikat / Azure Trusted Signing, oder erst unsigniert starten.
- **Windows 10:** transparent + eigene Ecken funktionieren dort; der Schlagschatten muss
  jedoch die App selbst malen (kein DWM). Akzeptiert, oder auf 11 beschränken?

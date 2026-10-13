/**
 * FFmpeg wird nicht gebündelt.
 *
 * Die meisten Rechner haben es längst – über winget, Chocolatey, Scoop, Homebrew
 * oder die Paketquelle. Die App sucht zuerst, was da ist, und lädt den Build nur
 * nach, wenn wirklich nichts gefunden wurde (docs/DESKTOP-PLAN.md §4). Wer schon
 * einen hat, bekommt keinen zweiten untergejubelt, und der Installer bleibt klein.
 *
 * Diese Datei rechnet nur mit Pfaden. Ob es sie gibt, prüft die Plattform –
 * deshalb ist die Reihenfolge hier testbar, ohne einen Rechner zu haben.
 */

export type DesktopPlatform = "win32" | "darwin" | "linux";

export interface FfmpegDirs {
  /** Neben der App selbst: hier legt der Installer den geladenen Build ab. */
  install: string;
  /** Pro Nutzer: hier lädt die App nach, wenn der Installer nichts mitbrachte. */
  userData: string;
  /** Heimatverzeichnis des Nutzers. */
  home: string;
}

export interface FfmpegCandidate {
  path: string;
  /**
   * Woher ein Fund stammt – der Nutzer sieht den Unterschied: `app` ist der Build,
   * den die App selbst geladen hat, `package` ein Paketmanager, `system` der
   * Rechner. Gefunden wird in dieser Reihenfolge.
   */
  source: "app" | "package" | "system";
}

export function candidates(platform: DesktopPlatform, dirs: FfmpegDirs): FfmpegCandidate[] {
  const sep = platform === "win32" ? "\\" : "/";
  const at = (base: string, ...parts: string[]) => [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
  const bin = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  if (platform === "win32") {
    return [
      { path: at(dirs.install, "ffmpeg", "bin", bin), source: "app" },
      { path: at(dirs.userData, "ffmpeg", "bin", bin), source: "app" },
      { path: at(dirs.home, "AppData", "Local", "Microsoft", "WinGet", "Links", bin), source: "package" },
      { path: at(dirs.home, "scoop", "shims", bin), source: "package" },
      { path: "C:\\ProgramData\\chocolatey\\bin\\" + bin, source: "package" },
      { path: "C:\\ffmpeg\\bin\\" + bin, source: "system" },
    ];
  }
  if (platform === "darwin") {
    return [
      { path: at(dirs.install, "ffmpeg", "bin", "ffmpeg"), source: "app" },
      { path: at(dirs.userData, "ffmpeg", "bin", "ffmpeg"), source: "app" },
      { path: "/opt/homebrew/bin/ffmpeg", source: "package" },
      { path: "/usr/local/bin/ffmpeg", source: "package" },
    ];
  }
  return [
    { path: at(dirs.install, "ffmpeg", "bin", "ffmpeg"), source: "app" },
    { path: at(dirs.userData, "ffmpeg", "bin", "ffmpeg"), source: "app" },
    { path: "/usr/bin/ffmpeg", source: "system" },
    { path: "/usr/local/bin/ffmpeg", source: "system" },
  ];
}

/** Der erste Kandidat, den es wirklich gibt. `exists` kommt von der Plattform. */
export function pickExisting(list: FfmpegCandidate[], exists: (path: string) => boolean): FfmpegCandidate | null {
  return list.find((c) => exists(c.path)) ?? null;
}

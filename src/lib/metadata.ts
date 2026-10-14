/**
 * Metadaten: was in der Datei stehen soll.
 *
 * Eine Sprache für drei Verbraucher: das Formular in der Oberfläche, den
 * FFmpeg-Befehl der Desktop-App und die Tags der Web-Engine. Vorher hätte jede
 * Stelle ihre eigenen Feldnamen erfunden – und die Serie wäre im einen Fall
 * „show", im anderen „series" und im dritten gar nicht geschrieben worden.
 *
 * Zwei Regeln gelten überall:
 *   1. Leere Felder werden nicht geschrieben. Ein leeres `-metadata title=`
 *      löscht einen vorhandenen Titel, und das will niemand versehentlich.
 *   2. Anzeige und Wirkung sind dasselbe. Was im Formular steht, steht danach
 *      auch in der Datei – oder die App sagt, warum nicht.
 */
import { CONTAINERS } from "./formats";
import { coverFitsContainer } from "./job";
import type { ContainerId, FileMetadata } from "./types";

export const EMPTY_METADATA: FileMetadata = {};

/** Ist hier irgendetwas eingetragen? */
export function isMetadataEmpty(m?: FileMetadata): boolean {
  if (!m) return true;
  return !(
    m.title?.trim() ||
    m.artist?.trim() ||
    m.year?.trim() ||
    m.genre?.trim() ||
    m.show?.trim() ||
    m.season?.trim() ||
    m.episode?.trim() ||
    m.episodeTitle?.trim() ||
    m.description?.trim() ||
    m.poster
  );
}

/** Vergleicht zwei Stände feldweise – der Haken im Formular hängt daran. */
export function sameMetadata(a?: FileMetadata, b?: FileMetadata): boolean {
  const keys: (keyof FileMetadata)[] = [
    "title",
    "artist",
    "year",
    "genre",
    "show",
    "season",
    "episode",
    "episodeTitle",
    "description",
  ];
  for (const k of keys) {
    const x = a?.[k];
    const y = b?.[k];
    if ((typeof x === "string" ? x.trim() : "") !== (typeof y === "string" ? y.trim() : "")) return false;
  }
  return (a?.poster?.url ?? "") === (b?.poster?.url ?? "");
}

/** Kurzform für die Dateiliste: „Der König der Löwen · S01E02". */
export function metadataSummary(m?: FileMetadata): string {
  if (!m) return "";
  const parts: string[] = [];
  const name = m.episodeTitle?.trim() || m.title?.trim() || m.show?.trim();
  if (m.show?.trim() && m.episodeTitle?.trim()) parts.push(m.show.trim());
  if (name) parts.push(name);
  else if (m.show?.trim()) parts.push(m.show.trim());
  const s = seasonNumber(m.season);
  const e = seasonNumber(m.episode);
  if (s !== null || e !== null) parts.push(`S${pad(s)}E${pad(e)}`);
  if (m.year?.trim()) parts.push(m.year.trim());
  return parts.join(" · ");
}

const pad = (n: number | null) => (n === null ? "–" : String(n).padStart(2, "0"));

/** Zahl aus einem Textfeld – „2", „02", „Staffel 2" ergeben alle 2. */
export function seasonNumber(value?: string): number | null {
  if (!value) return null;
  const m = value.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/* ───────────── Erkennen, was schon im Namen steht ───────────── */

export interface NameGuess {
  title?: string;
  year?: string;
  season?: string;
  episode?: string;
}

/**
 * Liest aus einem Dateinamen, was üblicherweise dort steht: Serientitel,
 * Staffel/Episode und Jahr. Das ist ein Vorschlag, keine Wahrheit – deshalb
 * füllt es nur, was noch leer ist, und die Oberfläche zeigt es als Vorschlag.
 */
export function guessFromName(name: string): NameGuess {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const guess: NameGuess = {};

  // S01E02, s1e2, Staffel 1 Folge 2
  const sxxexx = base.match(/\bS(\d{1,3})[\s._-]*E(\d{1,4})\b/i);
  if (sxxexx) {
    guess.season = String(Number(sxxexx[1]));
    guess.episode = String(Number(sxxexx[2]));
  } else {
    const german = base.match(/\bStaffel\s*(\d{1,3})[\s._-]*(?:Folge|Ep\.?)\s*(\d{1,4})\b/i);
    if (german) {
      guess.season = String(Number(german[1]));
      guess.episode = String(Number(german[2]));
    } else {
      // 1x02
      const cross = base.match(/\b(\d{1,3})x(\d{1,4})\b/);
      if (cross) {
        guess.season = String(Number(cross[1]));
        guess.episode = String(Number(cross[2]));
      }
    }
  }
  if (!guess.season) {
    const onlySeason = base.match(/\b(?:Staffel|Season)\s*(\d{1,3})\b/i);
    if (onlySeason) guess.season = String(Number(onlySeason[1]));
  }

  // Jahr: 1900–2099, bevorzugt in Klammern.
  const bracketed = base.match(/[([]((19|20)\d{2})[)\]]/);
  const loose = bracketed ?? base.match(/\b((19|20)\d{2})\b/);
  if (loose) guess.year = loose[1];

  // Der Titel ist alles vor der ersten Kennung – geputzt, aber unverändert im Sinn.
  const cut = base.search(/\b(?:S\d{1,3}[\s._-]*E\d{1,4}|Staffel|Season|Folge|Ep\.?\s*\d|\d{1,3}x\d{1,4})\b/i);
  let title = (cut > 0 ? base.slice(0, cut) : base)
    .replace(/[([]\s*(19|20)\d{2}\s*[)\]]/g, " ")
    /* Ein Jahr mitten im Namen bleibt stehen – eines am Ende ist eine Angabe. */
    .replace(/\s*\b(19|20)\d{2}\b\s*$/, "")
    .replace(/[-–_]\s*$/, "")
    .replace(/\s*[-–]\s*(1080p|720p|2160p|4k|hd|web|webrip|bluray|bdrip|dvdrip|x264|x265|h264|h265|hevc|aac|ac3|dts|remux|proper|repack).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title.length > 1 && title.length < 120) guess.title = title;

  return guess;
}

/* ───────────── FFmpeg ───────────── */

/**
 * Die Metadaten als FFmpeg-Argumente.
 *
 * Dieselben Namen wie in bewährten Werkzeugen, damit iTunes, VLC, Plex und der
 * Windows-Explorer dasselbe lesen: `title`, `artist`, `date`, `genre`,
 * `description` – und für Serien `show`, `season_number`, `episode_sort`,
 * `episode_id`, `episode_name`.
 */
export function ffmpegMetadataArgs(m?: FileMetadata): string[] {
  if (isMetadataEmpty(m)) return [];
  const out: string[] = [];
  const add = (key: string, value?: string) => {
    const v = value?.trim();
    if (v) out.push("-metadata", `${key}=${v}`);
  };
  add("artist", m!.artist);
  add("date", m!.year);
  add("genre", m!.genre);
  add("description", m!.description);
  add("comment", m!.description);
  add("show", m!.show);
  const season = seasonNumber(m!.season);
  if (season !== null && m!.show) {
    add("season_number", String(season));
    add("tv_season", String(season));
  }
  const episode = seasonNumber(m!.episode);
  if (episode !== null && (m!.show || m!.season)) {
    add("episode_sort", String(episode));
    add("tv_episode", String(episode));
  }
  add("episode_name", m!.episodeTitle);
  /*
   * Bei einer Folge ist der Folgentitel der Titel: iTunes, VLC und Plex zeigen
   * in der Liste den Titel, nicht den Seriennamen. Ein von Hand eingetragener
   * Titel gewinnt nur, wenn kein Folgentitel dasteht.
   */
  const displayTitle = m!.episodeTitle?.trim() || m!.title?.trim();
  if (displayTitle) out.push("-metadata", `title=${displayTitle}`);
  return out;
}

/* ───────────── Web-Engine (Mediabunny-Tags) ───────────── */

/**
 * Die Felder, die Mediabunny normalisiert schreiben kann – plus die rohen
 * Serien-Tags, die das neutrale Schema nicht kennt.
 *
 * `seriesNumbers` hängt am Zielcontainer: Matroska und WebM führen freie
 * Text-Tags, dort stehen Staffel und Episode als Text richtig. Im MP4-Format
 * sind `tvsn`/`tves` dagegen ganze Zahlen – die Web-Engine kann solche Atome
 * nicht erzeugen, deshalb werden sie dort weggelassen statt als Text
 * geschrieben, den andere Programme falsch lesen. Die Desktop-App schreibt sie.
 */
export function mediabunnyTags(m?: FileMetadata, seriesNumbers = true): Record<string, unknown> {
  if (isMetadataEmpty(m)) return {};
  const tags: Record<string, unknown> = {};
  const title = m!.episodeTitle?.trim() || m!.title?.trim();
  if (title) tags.title = title;
  if (m!.artist?.trim()) tags.artist = m!.artist.trim();
  if (m!.description?.trim()) {
    tags.description = m!.description.trim();
    tags.comment = m!.description.trim();
  }
  if (m!.genre?.trim()) tags.genre = m!.genre.trim();
  if (m!.show?.trim()) tags.album = m!.show.trim();
  const year = m!.year?.trim().match(/\d{4}/)?.[0];
  if (year) tags.date = new Date(Date.UTC(Number(year), 0, 1));

  const raw: Record<string, string> = {};
  if (m!.show?.trim()) raw.tvsh = m!.show.trim();
  if (seriesNumbers) {
    const season = seasonNumber(m!.season);
    if (season !== null && m!.show?.trim()) raw.tvsn = String(season);
    const episode = seasonNumber(m!.episode);
    if (episode !== null && (m!.show?.trim() || m!.season?.trim())) raw.tves = String(episode);
  }
  if (Object.keys(raw).length) tags.raw = raw;
  return tags;
}

export interface MetadataSupport {
  /** Werden Titel, Beschreibung und Co. überhaupt geschrieben? */
  fields: boolean;
  /** Werden Staffel und Episode als Zahlen geschrieben? */
  seriesNumbers: boolean;
  /** Wird das Titelbild eingebettet? */
  cover: boolean;
  /** Ein Satz für die Oberfläche, falls etwas nicht geht – sonst leer. */
  note: string;
}

/**
 * Was von den eingetragenen Feldern in diesem Container wirklich landet.
 *
 * Hier steht die Wahrheit, die ein Formular allein nicht liefert: MPEG-TS kennt
 * keine Metadaten, und MP4 führt Staffel/Episode als ganze Zahlen – die
 * Web-Engine kann solche Atome nicht erzeugen, die Desktop-App schon. Beides
 * wird gesagt, statt es auszuprobieren und zu schweigen.
 */
export function metadataSupport(
  engine: { metadata: boolean; cover: boolean },
  container: ContainerId
): MetadataSupport {
  const label = CONTAINERS[container].label;
  // MPEG-TS trägt keine beschreibenden Metadaten – in keinem Werkzeug.
  const keepsTags = container !== "ts";
  const notes: string[] = [];
  if (!keepsTags) notes.push(`${label} führt keine Metadaten – die Felder werden nicht geschrieben.`);
  else if (!engine.metadata) notes.push("Diese Engine schreibt keine Metadaten.");
  else if (!engine.cover && container !== "mkv" && container !== "webm")
    notes.push("Staffel- und Episodennummern schreibt im MP4-Format nur die Desktop-App.");
  const cover = engine.cover && coverFitsContainer(container);
  if (keepsTags && engine.metadata && !cover && coverFitsContainer(container) === false)
    notes.push(`${label} kann kein Titelbild aufnehmen.`);
  else if (keepsTags && engine.metadata && !engine.cover && coverFitsContainer(container))
    notes.push("Das Titelbild bettet nur die Desktop-App ein.");
  return {
    fields: keepsTags && engine.metadata,
    seriesNumbers: keepsTags && engine.metadata && (container === "mkv" || container === "webm" || engine.cover),
    cover,
    note: notes.join(" "),
  };
}

/** Wie viele Felder tatsächlich in die Datei geschrieben werden. */
export function metadataFieldCount(m?: FileMetadata): number {
  return ffmpegMetadataArgs(m).filter((s) => s.includes("=")).length;
}

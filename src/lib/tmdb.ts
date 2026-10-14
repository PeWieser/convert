/**
 * The Movie Database – Suche und Übernahme.
 *
 * Bewusst klein gehalten: suchen, anzeigen, übernehmen. Der Schlüssel bleibt im
 * Gerät (localStorage), es gibt keinen Server dazwischen und keine Konten.
 *
 * Zwei Eigenheiten der API sind hier eingebaut, weil sie sonst als Fehler
 * auftauchen würden:
 *   – Antworten kommen sprachabhängig; fehlt die Übersetzung, liefert TMDB
 *     englische Texte statt eines Fehlers. Das ist in Ordnung, aber sichtbar.
 *   – Ohne Verbindung antwortet nichts. Deshalb merkt sich die App die letzten
 *     Treffer und sagt ehrlich, dass sie aus dem Gedächtnis kommen.
 */
import type { FileMetadata } from "./types";
import { loadJSON, saveJSON } from "./storage";

const BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";

export interface TmdbHit {
  id: number;
  name: string;
  year: string;
  type: "tv" | "movie";
  overview: string;
  poster: string | null;
  /** Fehlt eine Übersetzung, steht hier der englische Ausgangstext. */
  originalName?: string;
}

export interface TmdbSeason {
  season: number;
  name: string;
  episodes: { number: number; name: string; overview: string; still: string | null }[];
}

export interface TmdbDetail {
  name: string;
  year: string;
  overview: string;
  genres: string;
  poster: string | null;
  seasons: TmdbSeason[];
}

export class TmdbError extends Error {
  /** Ein falscher Schlüssel wird nicht besser, wenn man es erneut versucht. */
  final: boolean;
  constructor(message: string, final = false) {
    super(message);
    this.final = final;
  }
}

const CACHE_KEY = "wandler.tmdb.cache.v1";
type Cache = Record<string, { at: number; hits: TmdbHit[] }>;

const posterUrl = (path: string | null, size = "w342") => (path ? `${IMAGE_BASE}/${size}${path}` : null);

async function call<T>(key: string, path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  } catch {
    throw new TmdbError("Keine Verbindung zu TMDB. Die Suche braucht Internet; ohne Netz bleiben nur die zuletzt gefundenen Treffer.");
  }
  if (res.status === 401) throw new TmdbError("Der TMDB-Schlüssel wurde abgelehnt. Bitte in den Einstellungen prüfen.", true);
  if (res.status === 429) throw new TmdbError("TMDB bremst gerade. Bitte einen Moment warten und erneut suchen.");
  if (!res.ok) throw new TmdbError(`TMDB antwortete mit Fehler ${res.status}.`);
  return (await res.json()) as T;
}

interface SearchResponse {
  results?: {
    id: number;
    media_type?: string;
    name?: string;
    title?: string;
    original_name?: string;
    original_title?: string;
    first_air_date?: string;
    release_date?: string;
    overview?: string;
    poster_path?: string | null;
  }[];
}

/** Sucht Filme und Serien zugleich. */
export async function searchTmdb(key: string, query: string, language = "de"): Promise<{ hits: TmdbHit[]; fromCache: boolean }> {
  const q = query.trim();
  if (!key.trim()) throw new TmdbError("Es ist kein TMDB-Schlüssel hinterlegt. Er lässt sich in den Einstellungen eintragen.", true);
  if (q.length < 2) return { hits: [], fromCache: false };

  const cache = loadJSON<Cache>(CACHE_KEY, {});
  const cacheKey = `${language}:${q.toLowerCase()}`;
  try {
    const data = await call<SearchResponse>(key, "/search/multi", { query: q, language, include_adult: "false" });
    const hits = (data.results ?? [])
      .filter((r) => r.media_type === "tv" || r.media_type === "movie")
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        name: (r.name ?? r.title ?? "").trim() || r.original_name || r.original_title || "Ohne Namen",
        originalName: (r.original_name ?? r.original_title ?? "").trim() || undefined,
        year: (r.first_air_date ?? r.release_date ?? "").slice(0, 4),
        type: r.media_type === "tv" ? ("tv" as const) : ("movie" as const),
        overview: (r.overview ?? "").trim(),
        poster: posterUrl(r.poster_path ?? null),
      }));
    const next: Cache = { ...cache, [cacheKey]: { at: Date.now(), hits } };
    const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at).slice(0, 24);
    saveJSON(CACHE_KEY, Object.fromEntries(keys.map((k) => [k, next[k]])));
    return { hits, fromCache: false };
  } catch (e) {
    const remembered = cache[cacheKey];
    if (remembered) return { hits: remembered.hits, fromCache: true };
    throw e;
  }
}

interface DetailResponse {
  name?: string;
  title?: string;
  first_air_date?: string;
  release_date?: string;
  overview?: string;
  genres?: { name: string }[];
  poster_path?: string | null;
  seasons?: { season_number: number; name: string; episode_count: number }[];
}

export async function tmdbDetail(key: string, hit: TmdbHit, language = "de"): Promise<TmdbDetail> {
  const data = await call<DetailResponse>(key, `/${hit.type}/${hit.id}`, { language });
  const seasons: TmdbSeason[] = (data.seasons ?? [])
    .filter((s) => s.season_number > 0)
    .map((s) => ({ season: s.season_number, name: s.name, episodes: [] }));
  return {
    name: (data.name ?? data.title ?? hit.name).trim(),
    year: (data.first_air_date ?? data.release_date ?? "").slice(0, 4) || hit.year,
    overview: (data.overview ?? hit.overview).trim(),
    genres: (data.genres ?? []).map((g) => g.name).join(", "),
    poster: posterUrl(data.poster_path ?? null, "w500"),
    seasons,
  };
}

export async function tmdbSeason(key: string, hit: TmdbHit, season: number, language = "de"): Promise<TmdbSeason> {
  const data = await call<{
    episodes?: { episode_number: number; name?: string; overview?: string; still_path?: string | null }[];
  }>(key, `/${hit.type}/${hit.id}/season/${season}`, { language });
  return {
    season,
    name: `Staffel ${season}`,
    episodes: (data.episodes ?? []).map((e) => ({
      number: e.episode_number,
      name: (e.name ?? "").trim(),
      overview: (e.overview ?? "").trim(),
      still: posterUrl(e.still_path ?? null, "w300"),
    })),
  };
}

/**
 * Macht aus einem Treffer die Felder der Datei.
 * Ist eine Folge gewählt, wird sie zur Hauptsache: Folgentitel als Titel,
 * Serienname als Serie, Staffel/Episode als Zahlen.
 */
export function metadataFromTmdb(
  hit: TmdbHit,
  detail: TmdbDetail,
  episode?: { season: number; number: number; name: string; overview: string }
): FileMetadata {
  if (hit.type === "movie") {
    return {
      title: detail.name,
      year: detail.year,
      genre: detail.genres,
      description: detail.overview,
      poster: detail.poster ? { url: detail.poster, mime: "image/jpeg" } : undefined,
    };
  }
  return {
    title: episode?.name || detail.name,
    show: detail.name,
    season: String(episode?.season ?? 1),
    episode: episode ? String(episode.number) : undefined,
    episodeTitle: episode?.name || undefined,
    year: detail.year,
    genre: detail.genres,
    description: episode?.overview || detail.overview,
    poster: detail.poster ? { url: detail.poster, mime: "image/jpeg" } : undefined,
  };
}

/** Ein Titelbild als Datei – für die Desktop-Ausgabe. */
export async function fetchPosterBytes(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new TmdbError(`Das Titelbild konnte nicht geladen werden (${res.status}).`);
  const mime = res.headers.get("content-type") ?? "image/jpeg";
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 8_000_000) throw new TmdbError("Das Titelbild ist unerwartet groß und wurde nicht übernommen.");
  return { bytes, mime };
}

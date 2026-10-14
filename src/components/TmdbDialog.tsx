/**
 * TMDB-Suche: finden, ansehen, übernehmen.
 *
 * Ein Fenster in zwei Schritten, weil TMDB so aufgebaut ist: Erst die Suche
 * (Serie oder Film), dann die Einzelheiten. Bei einer Serie kommt die Folge
 * dazu – Staffel wählen, Folge anklicken, und Titel, Staffelnummer,
 * Folgentitel und Beschreibung sind gesetzt.
 *
 * Ohne Schlüssel oder ohne Verbindung sagt das Fenster das, statt leer zu
 * bleiben; zuletzt Gefundenes kommt aus dem Gedächtnis der App zurück.
 */
import { ArrowLeft, Check, Film, ImageOff, Loader2, Search, Tv } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { metadataFromTmdb, searchTmdb, tmdbDetail, tmdbSeason, TmdbError } from "../lib/tmdb";
import type { TmdbDetail, TmdbHit, TmdbSeason } from "../lib/tmdb";
import type { FileMetadata } from "../lib/types";
import { cn } from "../utils/cn";
import { Btn, Sheet } from "./ui";

export function TmdbDialog({
  apiKey,
  language,
  initialQuery,
  onApply,
  onClose,
  onOpenSettings,
}: {
  apiKey: string;
  language: string;
  initialQuery: string;
  onApply: (m: FileMetadata) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  /** Vorschlag aus Dateiname oder Titel – Klammern und Endungen interessieren TMDB nicht. */
  const suggestion = initialQuery.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[._]+/g, " ").trim();
  const [query, setQuery] = useState(suggestion);
  const [hits, setHits] = useState<TmdbHit[] | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalError, setFinalError] = useState(false);
  const [hit, setHit] = useState<TmdbHit | null>(null);
  const [detail, setDetail] = useState<TmdbDetail | null>(null);
  const [season, setSeason] = useState<TmdbSeason | null>(null);
  const [seasonBusy, setSeasonBusy] = useState(false);
  const [episode, setEpisode] = useState<{ season: number; number: number; name: string; overview: string } | null>(null);
  const searched = useRef(false);

  const run = async (q: string) => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    setFinalError(false);
    try {
      const r = await searchTmdb(apiKey, q, language);
      setHits(r.hits);
      setFromCache(r.fromCache);
    } catch (e) {
      setHits([]);
      setError(e instanceof Error ? e.message : "Die Suche ist fehlgeschlagen.");
      setFinalError(e instanceof TmdbError && e.final);
    } finally {
      setBusy(false);
    }
  };

  /* Die Eingabe ist der Dateiname – die Suche startet von allein, aber nur einmal. */
  useEffect(() => {
    if (searched.current || apiKey.trim() || suggestion.length < 2) return;
    searched.current = true;
    void run(suggestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (h: TmdbHit) => {
    setHit(h);
    setEpisode(null);
    setSeason(null);
    setBusy(true);
    setError(null);
    try {
      setDetail(await tmdbDetail(apiKey, h, language));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Die Einzelheiten konnten nicht geladen werden.");
      setFinalError(e instanceof TmdbError && e.final);
    } finally {
      setBusy(false);
    }
  };

  const pickSeason = async (n: number) => {
    if (!hit) return;
    setSeasonBusy(true);
    setError(null);
    try {
      setSeason(await tmdbSeason(apiKey, hit, n, language));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Die Folgenliste konnte nicht geladen werden.");
    } finally {
      setSeasonBusy(false);
    }
  };

  const back = () => {
    setHit(null);
    setDetail(null);
    setSeason(null);
    setEpisode(null);
  };

  const apply = () => {
    if (!hit || !detail) return;
    onApply(metadataFromTmdb(hit, detail, episode ?? undefined));
  };

  return (
    <Sheet title="Bei TMDB suchen" onClose={onClose} width={620} height={640}>
      <header className="flex items-center gap-3 px-6 pb-3 pt-5">
        {hit && (
          <button onClick={back} aria-label="Zurück zur Suche" className="grid h-8 w-8 place-items-center rounded-full text-label2 transition hover:bg-fill active:scale-95">
            <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
          </button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-[18px] font-semibold tracking-tight">
          {hit ? hit.name : "Bei TMDB suchen"}
        </h2>
        {!hit && (
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void run(query)}
              placeholder="Serie oder Film"
              aria-label="Suchbegriff"
              autoFocus
              className="h-8 w-[236px] rounded-lg bg-fill px-2.5 text-[14px] transition hover:bg-fill2 focus:ring-2 focus:ring-accent/50"
            />
            <Btn variant="primary" onClick={() => void run(query)} disabled={busy || query.trim().length < 2}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" strokeWidth={2.2} />}
              Suchen
            </Btn>
          </div>
        )}
      </header>

      {!apiKey.trim() && (
        <div className="mx-6 mb-3 rounded-xl bg-fill px-4 py-3 text-[12.5px] leading-relaxed text-label2" role="note">
          Für die Suche fehlt der TMDB-Schlüssel. Er ist kostenlos und steht nach der Anmeldung bei
          the<a className="text-accent" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">moviedb.org</a> unter
          „API". Danach in den Einstellungen eintragen.{" "}
          <button className="font-medium text-accent" onClick={onOpenSettings}>
            Zu den Einstellungen
          </button>
        </div>
      )}

      {fromCache && !error && (
        <p className="mx-6 mb-3 rounded-xl bg-fill px-4 py-2 text-[12px] text-label2" role="status">
          Keine Verbindung zu TMDB – diese Treffer kommen aus dem Gedächtnis der App.
        </p>
      )}

      {error && (
        <div className="mx-6 mb-3 rounded-xl bg-fill px-4 py-3 text-[12.5px] text-warn" role="alert">
          {error}
          {finalError && !apiKey.trim() && (
            <>
              {" "}
              <button className="font-medium text-accent" onClick={onOpenSettings}>
                Zu den Einstellungen
              </button>
            </>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
        {!hit && (
          <>
            {hits === null && !busy && <p className="px-1 py-6 text-center text-[13px] text-label2">Noch nichts gesucht.</p>}
            {hits?.length === 0 && !busy && <p className="px-1 py-6 text-center text-[13px] text-label2">Nichts gefunden. Andere Schreibweise versuchen.</p>}
            <ul className="space-y-1.5">
              {hits?.map((h) => (
                <li key={`${h.type}-${h.id}`}>
                  <button
                    onClick={() => void open(h)}
                    className="flex w-full items-center gap-3 rounded-xl bg-surface px-3 py-2.5 text-left shadow-card transition hover:bg-fill"
                  >
                    {h.poster ? (
                      <img src={h.poster} alt="" className="h-[66px] w-[44px] shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="grid h-[66px] w-[44px] shrink-0 place-items-center rounded-md bg-fill text-label3">
                        <ImageOff className="h-4 w-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium">{h.name}</span>
                        <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-[5px]", h.type === "tv" ? "bg-accent/12 text-accent" : "bg-fill2 text-label2")}>
                          {h.type === "tv" ? <Tv className="h-2.5 w-2.5" strokeWidth={2.4} /> : <Film className="h-2.5 w-2.5" strokeWidth={2.4} />}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-label2">
                        {[h.year, h.type === "tv" ? "Serie" : "Film"].filter(Boolean).join(" · ")}
                      </span>
                      {h.overview && <span className="mt-1 line-clamp-2 block text-[12px] leading-snug text-label2">{h.overview}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {hit && detail && (
          <div className="space-y-4">
            <div className="flex gap-4">
              {detail.poster && <img src={detail.poster} alt="" className="h-[138px] w-[92px] shrink-0 rounded-lg object-cover shadow-card" />}
              <div className="min-w-0">
                <p className="text-[15px] font-medium">{detail.name}</p>
                <p className="mt-0.5 text-[12.5px] text-label2">{[detail.year, detail.genres].filter(Boolean).join(" · ")}</p>
                {detail.overview && <p className="mt-2 line-clamp-5 text-[12.5px] leading-snug text-label2">{detail.overview}</p>}
              </div>
            </div>

            {hit.type === "tv" && (
              <div className="rounded-xl bg-surface p-3 shadow-card">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {detail.seasons.length === 0 && <span className="text-[12.5px] text-label2">Keine Staffelangaben vorhanden.</span>}
                  {detail.seasons.map((s) => (
                    <button
                      key={s.season}
                      onClick={() => void pickSeason(s.season)}
                      className={cn(
                        "h-7 shrink-0 rounded-full px-3 text-[12.5px] font-medium transition",
                        season?.season === s.season ? "bg-[var(--accent-fill)] text-white" : "bg-fill text-label2 hover:bg-fill2"
                      )}
                    >
                      {s.season}
                    </button>
                  ))}
                  {seasonBusy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-label2" />}
                </div>
                {season && (
                  <ul className="mt-2 max-h-[220px] space-y-1 overflow-y-auto">
                    {season.episodes.map((e) => {
                      const active = episode?.number === e.number;
                      return (
                        <li key={e.number}>
                          <button
                            onClick={() =>
                              setEpisode({ season: season.season, number: e.number, name: e.name, overview: e.overview })
                            }
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
                              active ? "bg-accent/12" : "hover:bg-fill"
                            )}
                          >
                            <span className="tnum w-6 shrink-0 text-[12.5px] text-label2">{e.number}</span>
                            <span className="min-w-0 flex-1 truncate text-[13px]">{e.name || `Folge ${e.number}`}</span>
                            {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={3} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="px-1 pt-2 text-[11.5px] leading-snug text-label2">
                  {episode
                    ? `Übernommen wird Folge ${episode.number} – Titel, Staffel, Folgentitel und Beschreibung.`
                    : "Ohne Folgenauswahl werden Serienname und Beschreibung übernommen."}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-sep px-6 py-3">
        <Btn variant="secondary" onClick={onClose}>
          Abbrechen
        </Btn>
        <Btn variant="primary" onClick={apply} disabled={!detail}>
          Übernehmen
        </Btn>
      </footer>
    </Sheet>
  );
}

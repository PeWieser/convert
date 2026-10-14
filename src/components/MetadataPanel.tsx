/**
 * Metadaten bearbeiten.
 *
 * Der Reiter ergänzt die Werkzeuge einer Datei (Drehen · Zuschneiden ·
 * Schneiden) um das, was *in* der Datei steht: Titel, Serie, Folge, Jahr,
 * Beschreibung. Er zeigt zuerst, was schon da ist – ein leeres Formular würde
 * verlangen abzutippen, was die Datei längst weiß.
 *
 * Jeder geänderte Wert trägt denselben grünen Haken wie im Preset-Editor; ein
 * Klick darauf stellt genau diesen Wert wieder her.
 */
import { Image as ImageIcon, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { metadataSupport, seasonNumber, sameMetadata, guessFromName } from "../lib/metadata";
import type { Capabilities, FileMetadata, Preset } from "../lib/types";
import { cn } from "../utils/cn";
import { Btn, Group, Row, TextField } from "./ui";
import { TmdbDialog } from "./TmdbDialog";

/** Ein Eingabefeld, das sich wie die übrigen Zeilen benimmt – nur breiter. */
const WIDE = "w-[268px] text-left";

export function MetadataPanel({
  original,
  draft,
  onChange,
  onApplyToAll,
  caps,
  preset,
  sourceName,
  tmdbKey,
  tmdbLanguage,
  onOpenSettings,
}: {
  /** Was in der Datei steht – der Vergleichsstand für die Haken. */
  original?: FileMetadata;
  draft: FileMetadata;
  onChange: (patch: FileMetadata) => void;
  /** Serie, Jahr, Beschreibung und Titelbild für alle Dateien übernehmen. */
  onApplyToAll: () => void;
  caps: Capabilities;
  preset: Preset;
  sourceName: string;
  tmdbKey: string;
  tmdbLanguage: string;
  onOpenSettings: () => void;
}) {
  const [tmdb, setTmdb] = useState(false);
  const support = metadataSupport(caps, preset.container);
  const guess = guessFromName(sourceName);

  const set = (patch: Partial<FileMetadata>) => onChange({ ...draft, ...patch });
  const field = (key: keyof FileMetadata) => ({
    /* Das Titelbild ist ein Objekt – verglichen wird die Adresse, nicht die Hülle. */
    changed:
      key === "poster"
        ? (draft.poster?.url ?? "") !== (original?.poster?.url ?? "")
        : (draft[key] ?? "") !== (original?.[key] ?? ""),
    onRevert: () =>
      onChange(
        key === "poster"
          ? { ...draft, poster: original?.poster }
          : { ...draft, [key]: original?.[key] ?? "" }
      ),
  });

  const anyChange = !sameMetadata(draft, original);
  /* Erst wenn wirklich eine Serie im Spiel ist, wird der Hinweis zum Format wichtig. */
  const seriesNeeded = !!draft.show?.trim() || seasonNumber(draft.season) !== null || seasonNumber(draft.episode) !== null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="primary" size="sm" onClick={() => setTmdb(true)}>
            <Search className="h-3.5 w-3.5" strokeWidth={2.2} />
            Bei TMDB suchen
          </Btn>
          {(guess.title || guess.season) && (
            <Btn
              variant="secondary"
              size="sm"
              onClick={() =>
                set({
                  title: draft.title?.trim() ? draft.title : guess.title,
                  year: draft.year?.trim() ? draft.year : guess.year,
                  season: draft.season?.trim() ? draft.season : guess.season,
                  episode: draft.episode?.trim() ? draft.episode : guess.episode,
                })
              }
              title="Was im Dateinamen steht, als Vorschlag übernehmen"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              Aus dem Dateinamen
            </Btn>
          )}
          {anyChange && (
            <Btn variant="ghost" size="sm" onClick={() => onChange(original ?? {})}>
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
              Alles zurücksetzen
            </Btn>
          )}
          {anyChange && (
            <Btn variant="ghost" size="sm" className="ml-auto" onClick={onApplyToAll} title="Serie, Jahr, Genre, Beschreibung und Titelbild für alle Dateien übernehmen">
              Auf alle anwenden
            </Btn>
          )}
        </div>

        <Group title="Titel & Beschreibung" footer={support.note || undefined}>
          <Row label="Titel" {...field("title")}>
            <TextField value={draft.title ?? ""} className={WIDE} ariaLabel="Titel" placeholder={guess.title ?? "Titel der Datei"} onChange={(v) => set({ title: v })} />
          </Row>
          <Row label="Beschreibung">
            <div className="w-[420px] max-w-full">
              <textarea
                value={draft.description ?? ""}
                onChange={(e) => set({ description: e.target.value })}
                rows={4}
                aria-label="Beschreibung"
                placeholder="Worum geht es?"
                className="w-full resize-y rounded-lg bg-fill px-2.5 py-2 text-left text-[13.5px] leading-snug transition hover:bg-fill2 focus:ring-2 focus:ring-accent/50"
              />
            </div>
          </Row>
          <Row label="Jahr" {...field("year")}>
            <TextField value={draft.year ?? ""} className="w-[100px] text-left" ariaLabel="Jahr" placeholder="2007" onChange={(v) => set({ year: v.replace(/[^\d]/g, "").slice(0, 4) })} />
          </Row>
          <Row label="Genre" {...field("genre")}>
            <TextField value={draft.genre ?? ""} className={WIDE} ariaLabel="Genre" placeholder="Drama, Komödie …" onChange={(v) => set({ genre: v })} />
          </Row>
          <Row label="Interpret / Studio" sub="Regisseur, Sender oder Künstler" {...field("artist")}>
            <TextField value={draft.artist ?? ""} className={WIDE} ariaLabel="Interpret oder Studio" onChange={(v) => set({ artist: v })} />
          </Row>
        </Group>

        <Group
          title="Serie & Folge"
          footer={
            seriesNeeded && !support.seriesNumbers
              ? "Staffel und Episodennummer schreibt in diesem Format nur die Desktop-App. Serienname und Folgentitel werden auch hier geschrieben."
              : "Serienname, Staffel und Folge – danach richten sich Sortierung und Anzeige in iTunes, VLC und Plex."
          }
        >
          <Row label="Serie" {...field("show")}>
            <TextField value={draft.show ?? ""} className={WIDE} ariaLabel="Serie" placeholder="Name der Serie" onChange={(v) => set({ show: v })} />
          </Row>
          <div className={cn("grid grid-cols-2 gap-4 px-4 py-2", !seriesNeeded && "opacity-70")}>
            <label className="flex items-center justify-between gap-3">
              <span className="text-[14px]">Staffel</span>
              <TextField value={draft.season ?? ""} className="w-[88px] text-left" ariaLabel="Staffel" placeholder="1" onChange={(v) => set({ season: v.replace(/[^\d]/g, "").slice(0, 3) })} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-[14px]">Episode</span>
              <TextField value={draft.episode ?? ""} className="w-[88px] text-left" ariaLabel="Episode" placeholder="2" onChange={(v) => set({ episode: v.replace(/[^\d]/g, "").slice(0, 4) })} />
            </label>
          </div>
          <Row label="Folgentitel" {...field("episodeTitle")}>
            <TextField value={draft.episodeTitle ?? ""} className={WIDE} ariaLabel="Folgentitel" onChange={(v) => set({ episodeTitle: v })} />
          </Row>
        </Group>

        <Group
          title="Titelbild"
          footer={support.cover ? "Das Bild wird in die Datei eingebettet." : "Titelbilder bettet nur die Desktop-App ein – hier bleibt es bei Titel und Beschreibung."}
        >
          <Row label="Bild">
            <div className="flex items-center gap-3">
              {draft.poster?.url ? (
                <img src={draft.poster.url} alt="" className="h-[72px] w-[48px] rounded-md object-cover shadow-card" />
              ) : (
                <span className="grid h-[72px] w-[48px] place-items-center rounded-md bg-fill text-label3">
                  <ImageIcon className="h-5 w-5" strokeWidth={1.6} />
                </span>
              )}
              <div className="flex flex-col items-start gap-1.5">
                <Btn size="sm" variant="secondary" onClick={() => setTmdb(true)}>
                  Bei TMDB wählen
                </Btn>
                {draft.poster?.url && (
                  <Btn size="sm" variant="danger" onClick={() => set({ poster: undefined })}>
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    Entfernen
                  </Btn>
                )}
              </div>
              {field("poster").changed && <RevertDot onRevert={field("poster").onRevert} />}
            </div>
          </Row>
        </Group>
      </div>

      {tmdb && (
        <TmdbDialog
          apiKey={tmdbKey}
          language={tmdbLanguage}
          initialQuery={draft.show || draft.title || guess.title || sourceName}
          onOpenSettings={onOpenSettings}
          onClose={() => setTmdb(false)}
          onApply={(next) => {
            onChange({ ...draft, ...next });
            setTmdb(false);
          }}
        />
      )}
    </div>
  );
}

/** Der Zurücksetzen-Haken für Felder, die nicht in einer Row mit Haken sitzen. */
function RevertDot({ onRevert }: { onRevert: () => void }) {
  return (
    <button
      type="button"
      onClick={onRevert}
      aria-label="Titelbild zurücksetzen"
      className="anim-fade grid h-6 w-6 place-items-center rounded-full bg-ok text-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition hover:bg-warn active:scale-90"
    >
      <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.4} />
    </button>
  );
}

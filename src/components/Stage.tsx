import { Plus } from "lucide-react";
import { modKey } from "../lib/format";
import type { Item, Preset } from "../lib/types";
import { cn } from "../utils/cn";
import { FileRow } from "./FileRow";
import { Btn } from "./ui";

function StackGlyph({ lifted }: { lifted: boolean }) {
  return (
    <svg viewBox="0 0 96 80" className="h-[80px] w-[96px]" aria-hidden>
      <rect x="18" y="14" width="60" height="44" rx="10" className="fill-fill" />
      <rect
        x="10"
        y="22"
        width="76"
        height="52"
        rx="12"
        className={cn("fill-surface stroke-sep transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]", lifted && "-translate-y-2")}
        strokeWidth="1.5"
      />
      <path
        d="M43 39.5v15l13-7.5z"
        className={cn("fill-accent transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]", lifted && "-translate-y-2")}
      />
    </svg>
  );
}

export function Stage({
  items,
  preset,
  outFolderName,
  canWriteFolders,
  dragging,
  running,
  onAddFiles,
  onAddFolder,
  onRemove,
  onRetry,
  onClear,
  onOpen,
  onReveal,
  selected,
  onToggleSelect,
  onClearSelection,
}: {
  items: Item[];
  preset: Preset;
  /** Wohin die fertigen Dateien gehen – steht im leeren Zustand, nicht erst im Fuß. */
  outFolderName: string;
  /** Darf diese Umgebung in einen Ordner schreiben, oder wird nur heruntergeladen? */
  canWriteFolders: boolean;
  dragging: boolean;
  running: boolean;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onClear: () => void;
  /** Fehlt es, bleibt die Liste reine Anzeige – während der Konvertierung. */
  onOpen?: (id: string) => void;
  /** Fertige Datei im Dateimanager zeigen (nur Desktop). */
  onReveal?: (item: Item) => void;
  selected: string[];
  onToggleSelect: (id: string) => void;
  onClearSelection: () => void;
}) {
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[360px] flex-1 flex-col items-center justify-center rounded-[28px] px-8 py-12 text-center transition-[background-color,box-shadow] duration-300",
          dragging ? "bg-accent/[0.06] shadow-[inset_0_0_0_2px_var(--accent)]" : "shadow-[inset_0_0_0_1.5px_var(--sep)]"
        )}
      >
        <StackGlyph lifted={dragging} />
        <h1 className="mt-6 text-[26px] font-semibold tracking-[-0.022em]">
          {dragging ? "Loslassen" : "Videos und Musik hierher ziehen"}
        </h1>
        <div className={cn("mt-6 flex items-center gap-2.5 transition-opacity duration-200", dragging && "opacity-0")}>
          <Btn variant="primary" size="lg" onClick={onAddFiles} title={`Dateien auswählen  ${modKey()}+O`}>
            Auswählen …
          </Btn>
          <Btn variant="plain" size="lg" onClick={onAddFolder} className="min-w-0 px-5" title={`Ganzen Ordner hinzufügen  ${modKey()}+⇧+O`}>
            Ordner wählen …
          </Btn>
        </div>
        {/*
          Die beiden Sätze, die sonst als Frage im Raum stehen: Was passiert mit
          meinen Dateien, und wo finde ich sie danach wieder? Beides beantwortet
          die App hier, bevor der erste Klick passiert ist.
        */}
        {!dragging && (
          <p className="mt-7 max-w-[400px] text-[12.5px] leading-relaxed text-label3">
            {/*
              Wohin die Dateien gehen, hängt davon ab, was dieser Browser darf.
              Ein Versprechen über den Zielordner wäre hier im schlimmsten Fall
              falsch – nämlich genau dann, wenn die Datei im Download landet.
            */}
            {canWriteFolders ? (
              <>
                Aus einem Ordner landen die fertigen Dateien im Unterordner{" "}
                <span className="font-medium text-label2">{`„${outFolderName || "Konvertiert"}"`}</span> daneben.
              </>
            ) : (
              <>Die fertigen Dateien kommen in den Download-Ordner dieses Browsers.</>
            )}
            <br />
            Die Originale bleiben unangetastet.
          </p>
        )}
      </div>
    );
  }

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[20px] bg-surface shadow-card transition-shadow duration-200",
        dragging && "shadow-[0_0_0_2px_var(--accent),var(--sh-card)]"
      )}
    >
      <ul aria-label="Dateien">
        {items.map((item) => (
          <FileRow key={item.id} item={item} preset={preset} locked={running} onRemove={onRemove}
            onRetry={onRetry}
            onOpen={onOpen}
            onReveal={onReveal}
            selected={selected.includes(item.id)}
            onToggleSelect={onToggleSelect}
            onClearSelection={onClearSelection}
          />
        ))}
      </ul>
      {!running && (
        <div className="flex h-11 items-center justify-between border-t border-sep px-2">
          <div className="flex items-center">
            <Btn variant="plain" size="sm" onClick={onAddFiles} title={`Dateien auswählen  ${modKey()}+O`}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              Hinzufügen
            </Btn>
            <Btn variant="plain" size="sm" onClick={onAddFolder} title={`Ganzen Ordner hinzufügen  ${modKey()}+⇧+O`}>
              Ordner
            </Btn>
          </div>
          <Btn variant="ghost" size="sm" onClick={onClear}>
            Alle entfernen
          </Btn>
        </div>
      )}
    </section>
  );
}

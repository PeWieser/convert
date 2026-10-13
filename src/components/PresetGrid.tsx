import { Copy, Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { presetSummary } from "../lib/presets";
import type { Preset } from "../lib/types";
import { cn } from "../utils/cn";
import { DotsGlyph, PresetIcon } from "./PresetIcon";
import { Btn, Menu, MenuItem, Sheet } from "./ui";

/**
 * Alle Presets auf einen Blick.
 *
 * Die Leiste zeigt, was nebeneinander passt. Dieses Fenster zeigt, was da ist –
 * immer erreichbar über den Knopf rechts in der Leiste, nicht erst ab einer
 * bestimmten Zahl von Presets. Dieselben Karten, dieselbe Auswahl, dieselben
 * Aktionen: zwei Ansichten derselben Sache, nicht zwei Bedienwelten.
 */
export function PresetGrid({
  presets,
  selectedId,
  disabled,
  lockReason,
  canDelete,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onAdd,
  onClose,
}: {
  presets: Preset[];
  selectedId: string;
  /** Während ein Lauf arbeitet, ist nichts davon veränderbar. */
  disabled: boolean;
  lockReason?: string;
  /** Das letzte Preset bleibt stehen. */
  canDelete: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmId) return;
    const t = setTimeout(() => setConfirmId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmId]);

  const close = () => {
    setMenu(null);
    setConfirmId(null);
  };

  return (
    <Sheet title="Presets" onClose={onClose} width={784} height={620}>
      <header className="flex items-center justify-between px-6 pb-2 pt-5">
        <h2 className="text-[20px] font-semibold tracking-tight">Presets</h2>
        <Btn variant="primary" onClick={onClose}>
          Fertig
        </Btn>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-3">
        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Preset">
          {presets.map((p) => {
            const selected = p.id === selectedId;
            const menuOpen = menu?.id === p.id;
            return (
              <div
                key={p.id}
                role="radio"
                aria-checked={selected}
                aria-disabled={disabled}
                aria-label={`${p.name}, ${presetSummary(p)}`}
                title={disabled ? lockReason : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  if (disabled) return;
                  onSelect(p.id);
                  onClose();
                }}
                onDoubleClick={() => {
                  if (disabled) return;
                  onClose();
                  onEdit(p.id);
                }}
                onKeyDown={(e) => {
                  if (disabled) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(p.id);
                    onClose();
                  }
                }}
                className={cn(
                  "group relative flex cursor-pointer select-none items-center gap-3 rounded-[18px] bg-surface p-3 text-left shadow-card transition-[box-shadow,transform,opacity,background-color] duration-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-3 focus-visible:outline-[color-mix(in_srgb,var(--accent)_60%,transparent)] focus-visible:outline-offset-2",
                  selected
                    ? "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent)_84%,white)_0%,var(--accent)_46%,color-mix(in_srgb,var(--accent)_82%,black)_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(0,0,0,0.2),0_5px_16px_color-mix(in_srgb,var(--accent)_38%,transparent),0_0_0_1px_color-mix(in_srgb,var(--accent)_55%,black)]"
                    : "hover:-translate-y-[1px] [&:active:not(:has(button:active))]:scale-[0.985]",
                  disabled && !selected && "pointer-events-none opacity-40",
                  disabled && selected && "opacity-70"
                )}
              >
                <PresetIcon icon={p.icon} size={42} className={selected ? "ring-2 ring-white/45" : undefined} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">{p.name}</div>
                  <div className={cn("truncate text-[12px]", selected ? "text-white/75" : "text-label2")}>
                    {presetSummary(p)}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (disabled) return;
                    setMenu(menuOpen ? null : { id: p.id, anchor: e.currentTarget });
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={disabled}
                  aria-label={`${p.name}: Aktionen`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  title={disabled ? lockReason : `${p.name}: Aktionen`}
                  className={cn(
                    "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full transition active:scale-90",
                    selected ? "text-white/70 hover:bg-white/15 hover:text-white" : "text-label3 hover:bg-fill hover:text-label",
                    "opacity-60 group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-30",
                    menuOpen && (selected ? "bg-white/20 text-white opacity-100" : "bg-fill text-label opacity-100")
                  )}
                >
                  <DotsGlyph className="h-[17px] w-[17px]" />
                </button>

                <Menu open={menuOpen} onClose={close} anchor={menu?.anchor ?? null} align="end" width={216}>
                  <MenuItem
                    icon={<Settings2 className="h-4 w-4" />}
                    title="Einstellungen"
                    onClick={() => {
                      close();
                      onClose();
                      onEdit(p.id);
                    }}
                  />
                  <MenuItem
                    icon={<Copy className="h-4 w-4" />}
                    title="Duplizieren"
                    onClick={() => {
                      close();
                      onDuplicate(p.id);
                    }}
                  />
                  <div className="mx-2.5 my-1 h-px bg-sep" />
                  {confirmId === p.id ? (
                    <MenuItem
                      danger
                      icon={<Trash2 className="h-4 w-4" />}
                      title="Wirklich löschen"
                      onClick={() => {
                        close();
                        onDelete(p.id);
                      }}
                    />
                  ) : (
                    <MenuItem
                      danger
                      disabled={!canDelete}
                      icon={<Trash2 className="h-4 w-4" />}
                      title="Löschen"
                      sub={canDelete ? undefined : "Das letzte Preset bleibt"}
                      onClick={() => setConfirmId(p.id)}
                    />
                  )}
                </Menu>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="flex items-center px-6 pb-5 pt-2">
        <Btn onClick={onAdd} disabled={disabled} title={disabled ? lockReason : "Neues Preset"}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          Neues Preset
        </Btn>
      </footer>
    </Sheet>
  );
}

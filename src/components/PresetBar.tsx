import { Copy, Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { presetSummary } from "../lib/presets";
import type { Preset } from "../lib/types";
import { cn } from "../utils/cn";
import { DotsGlyph, PresetIcon } from "./PresetIcon";
import { Menu, MenuItem } from "./ui";

export function PresetBar({
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
}: {
  presets: Preset[];
  selectedId: string;
  disabled: boolean;
  /** Warum gesperrt – als `title` an jedem stummen Bedienelement. */
  lockReason?: string;
  /** Das letzte Preset bleibt stehen. */
  canDelete: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  /** Offenes Menü samt dem Knopf, an dem es hängt. */
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmId) return;
    const t = setTimeout(() => setConfirmId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmId]);

  useEffect(() => {
    if (disabled) setMenu(null);
  }, [disabled]);

  const close = () => {
    setMenu(null);
    setConfirmId(null);
  };

  return (
    <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-5 pt-3" role="radiogroup" aria-label="Format">
      {presets.map((p, index) => {
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
            onClick={() => !disabled && onSelect(p.id)}
            onDoubleClick={() => !disabled && onEdit(p.id)}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(p.id);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const n = presets.length;
                const next =
                  e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (index + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
                const radios = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]');
                radios?.[next]?.focus();
                onSelect(presets[next].id);
              }
            }}
            className={cn(
              "group relative flex w-[236px] shrink-0 select-none items-center gap-3 rounded-[18px] bg-surface py-3 pl-3 pr-3 text-left shadow-card transition-[box-shadow,transform,opacity] duration-200 ease-out active:scale-[0.985] focus-visible:outline-3 focus-visible:outline-[color-mix(in_srgb,var(--accent)_60%,transparent)] focus-visible:outline-offset-2",
              selected ? "shadow-[0_0_0_2px_var(--accent),var(--sh-card)]" : "hover:-translate-y-[1px]",
              disabled && !selected && "pointer-events-none opacity-40",
              disabled && selected && "opacity-70"
            )}
          >
            <PresetIcon icon={p.icon} size={42} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">{p.name}</div>
              <div className="truncate text-[12px] text-label2">{presetSummary(p)}</div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (disabled) return;
                setMenu(menuOpen ? null : { id: p.id, anchor: e.currentTarget });
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              disabled={disabled}
              aria-label={`${p.name}: Aktionen`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={disabled ? lockReason : `${p.name}: Aktionen`}
              className={cn(
                "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-label3 transition hover:bg-fill hover:text-label active:scale-90",
                "opacity-60 group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-30",
                menuOpen && "bg-fill text-label opacity-100"
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

      <button
        onClick={onAdd}
        disabled={disabled}
        title={disabled ? lockReason : "Neues Preset"}
        aria-label="Neues Preset"
        className="grid w-[66px] shrink-0 place-items-center rounded-[18px] text-label2 shadow-[inset_0_0_0_1.5px_var(--sep)] transition hover:text-label hover:shadow-[inset_0_0_0_1.5px_var(--label-3)] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
      >
        <Plus className="h-5 w-5" strokeWidth={1.8} />
      </button>
    </div>
  );
}

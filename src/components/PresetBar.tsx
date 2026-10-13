import { Plus } from "lucide-react";
import { presetSummary } from "../lib/presets";
import type { Preset } from "../lib/types";
import { cn } from "../utils/cn";
import { PresetIcon, SlidersGlyph } from "./PresetIcon";

export function PresetBar({
  presets,
  selectedId,
  disabled,
  lockReason,
  onSelect,
  onEdit,
  onAdd,
}: {
  presets: Preset[];
  selectedId: string;
  disabled: boolean;
  /** Warum gesperrt – als `title` an jedem stummen Bedienelement. */
  lockReason?: string;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-5 pt-3" role="radiogroup" aria-label="Format">
      {presets.map((p, index) => {
        const selected = p.id === selectedId;
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
              disabled && !selected && "pointer-events-none opacity-40"
            )}
          >
            <PresetIcon icon={p.icon} size={42} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">{p.name}</div>
              <div className="truncate text-[12px] text-label2">{presetSummary(p)}</div>
            </div>
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center">
              {selected && !disabled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(p.id);
                  }}
                  aria-label={`${p.name} anpassen`}
                  title={`${p.name} anpassen`}
                  className="anim-fade grid h-[30px] w-[30px] place-items-center rounded-full bg-fill text-label2 transition hover:bg-fill2 hover:text-label active:scale-90"
                >
                  <SlidersGlyph className="h-[17px] w-[17px]" />
                </button>
              )}
            </span>
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

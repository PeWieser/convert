import { Copy, Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { slotShift } from "../lib/order";
import { presetSummary } from "../lib/presets";
import type { Preset } from "../lib/types";
import { cn } from "../utils/cn";
import { DotsGlyph, PresetIcon } from "./PresetIcon";
import { Menu, MenuItem } from "./ui";

/** Ab dieser Bewegung in px ist es ein Ziehen und kein Klick mehr. */
const DRAG_THRESHOLD = 6;

/** So lange gleitet die Karte nach dem Loslassen in ihre Lücke, bevor gespeichert wird. */
const SETTLE_MS = 340;

/** Die Bewegungskurve der App: zieht an, bremst weich. Nichts daran ist linear. */
const GLIDE = "cubic-bezier(0.32, 0.72, 0, 1)";

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
  onReorder,
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
  /** Verschiebt ein Preset an eine neue Stelle in der Reihenfolge. */
  onReorder: (id: string, toIndex: number) => void;
}) {
  /** Offenes Menü samt dem Knopf, an dem es hängt. */
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  /* ── Ziehen zum Umsortieren ── */
  const [drag, setDrag] = useState<{ id: string; dx: number | null; from: number; to: number } | null>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const press = useRef<{ id: string; index: number; x: number; y: number } | null>(null);
  /** Mittellinien und Kartenabstand beim Losziehen – gemessen, nicht geraten. */
  const geometry = useRef<{ centers: { id: string; x: number }[]; pitch: number }>({ centers: [], pitch: 0 });
  /** Ein Loslassen nach dem Ziehen darf nicht noch als Klick gelten. */
  const swallowClick = useRef(false);

  useEffect(() => {
    if (!confirmId) return;
    const t = setTimeout(() => setConfirmId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmId]);

  useEffect(() => {
    if (disabled) {
      setMenu(null);
      setDrag(null);
      press.current = null;
    }
  }, [disabled]);

  useEffect(() => {
    if (!drag) return;
    const id = drag.id;

    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || dragRef.current?.dx === null) return;
      const dx = e.clientX - p.x;
      const { centers } = geometry.current;
      /* Zielstelle = wie viele andere Karten liegen links vom Zeiger. */
      const to = Math.max(0, Math.min(centers.length, centers.filter((c) => c.id !== id && c.x < e.clientX).length));
      setDrag((d) => (d ? { ...d, dx, to } : d));
    };

    const up = () => {
      const d = dragRef.current;
      press.current = null;
      if (!d) {
        setDrag(null);
        return;
      }
      swallowClick.current = true;
      /* dx auf null: die Karte folgt nicht mehr dem Zeiger, sondern gleitet in
         ihre Lücke. Gespeichert wird erst, wenn sie dort ist – sonst springt sie. */
      setDrag({ ...d, dx: null });
      window.setTimeout(() => {
        if (d.to !== d.from) onReorder(d.id, d.to);
        setDrag(null);
      }, SETTLE_MS);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag !== null, onReorder]);

  /** Der Effekt hängt am Fenster; er muss den aktuellen Stand sehen, nicht den von vor drei Zügen. */
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const beginPress = (p: Preset, index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || e.pointerType === "touch" || menu) return;
    press.current = { id: p.id, index, x: e.clientX, y: e.clientY };

    const arm = (ev: PointerEvent) => {
      const start = press.current;
      if (!start || start.id !== p.id) return;
      if (Math.abs(ev.clientX - start.x) < DRAG_THRESHOLD) return;
      window.removeEventListener("pointermove", arm);
      const ids = presets.map((x) => x.id);
      const rects = ids.map((cid) => cards.current.get(cid)?.getBoundingClientRect());
      const known = rects.filter((r): r is DOMRect => !!r);
      if (known.length < 2) return;
      geometry.current = {
        centers: ids
          .map((cid, i) => ({ id: cid, x: rects[i] ? rects[i]!.left + rects[i]!.width / 2 : 0 }))
          .filter((c) => c.x > 0),
        pitch: known[1].left - known[0].left,
      };
      setDrag({ id: start.id, dx: ev.clientX - start.x, from: index, to: index });
      press.current = { ...start, x: ev.clientX };
    };
    window.addEventListener("pointermove", arm);
    window.addEventListener(
      "pointerup",
      () => {
        press.current = null;
        window.removeEventListener("pointermove", arm);
      },
      { once: true }
    );
  };

  const close = () => {
    setMenu(null);
    setConfirmId(null);
  };

  return (
    <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-5 pt-3" role="radiogroup" aria-label="Format">
      {presets.map((p, index) => {
        const selected = p.id === selectedId;
        const menuOpen = menu?.id === p.id;
        const isDragged = drag?.id === p.id;
        const shift = drag && !isDragged ? slotShift(index, drag.from, drag.to) : 0;
        return (
          <div
            key={p.id}
            ref={(el) => {
              if (el) cards.current.set(p.id, el);
              else cards.current.delete(p.id);
            }}
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            aria-label={`${p.name}, ${presetSummary(p)}`}
            title={disabled ? lockReason : undefined}
            tabIndex={selected ? 0 : -1}
            onPointerDown={beginPress(p, index)}
            onClick={() => {
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              if (!disabled) onSelect(p.id);
            }}
            onDoubleClick={() => !disabled && onEdit(p.id)}
            onKeyDown={(e) => {
              if (disabled) return;
              const n = presets.length;
              /* Strg/⌘ + Pfeil verschiebt, der Pfeil allein wählt aus. */
              if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                const to = Math.max(0, Math.min(n - 1, index + (e.key === "ArrowRight" ? 1 : -1)));
                if (to !== index) onReorder(p.id, to);
                return;
              }
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(p.id);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (index + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
                const radios = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]');
                radios?.[next]?.focus();
                onSelect(presets[next].id);
              }
            }}
            style={
              isDragged
                ? drag!.dx === null
                  ? {
                      transform: `translateX(${(drag!.to - drag!.from) * geometry.current.pitch}px)`,
                      zIndex: 20,
                      cursor: "grabbing",
                      transition: `transform ${SETTLE_MS}ms ${GLIDE}`,
                    }
                  : {
                      transform: `translate3d(${drag!.dx}px, -5px, 0) scale(1.035)`,
                      zIndex: 20,
                      cursor: "grabbing",
                      transition: "none",
                    }
                : shift
                  ? { transform: `translateX(${shift * geometry.current.pitch}px)` }
                  : undefined
            }
            className={cn(
              "group relative flex w-[236px] shrink-0 cursor-pointer select-none items-center gap-3 rounded-[18px] bg-surface py-3 pl-3 pr-3 text-left shadow-card transition-[box-shadow,transform,opacity,background-color] duration-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.985] focus-visible:outline-3 focus-visible:outline-[color-mix(in_srgb,var(--accent)_60%,transparent)] focus-visible:outline-offset-2",
              /* Ausgewählt heißt: die ganze Karte trägt die Farbe, nicht nur ihr Rand. */
              selected
                ? "bg-[color-mix(in_srgb,var(--accent)_11%,var(--surface))] shadow-[0_0_0_2px_var(--accent),var(--sh-card)]"
                : "hover:-translate-y-[1px]",
              disabled && !selected && "pointer-events-none opacity-40",
              disabled && selected && "opacity-70",
              isDragged && "shadow-[0_16px_36px_rgba(0,0,0,0.22),0_0_0_1px_var(--sep)]"
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
              onPointerDown={(e) => e.stopPropagation()}
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

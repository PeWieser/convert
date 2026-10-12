import { ChevronsUpDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode, RefObject } from "react";
import { cn } from "../utils/cn";

/* ───────────── Buttons ───────────── */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "plain" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
};

export function Btn({ variant = "secondary", size = "md", className, type = "button", ...rest }: BtnProps) {
  const sizes = {
    sm: "h-7 px-3 text-[13px]",
    md: "h-8 px-3.5 text-[13px]",
    lg: "h-11 min-w-[140px] px-7 text-[15px] font-semibold",
  };
  const variants = {
    primary:
      "bg-[var(--accent-fill)] text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:brightness-110 active:brightness-95",
    secondary: "bg-fill text-label hover:bg-fill2",
    plain: "text-accent hover:bg-accent/10",
    danger: "text-bad hover:bg-bad/10",
    ghost: "text-label2 hover:bg-fill",
  };
  return (
    <button
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        sizes[size],
        variants[variant],
        className
      )}
      {...rest}
    />
  );
}

export function IconBtn({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "no-drag grid h-8 w-8 place-items-center rounded-full text-label2 transition duration-150 hover:bg-fill hover:text-label active:scale-95 disabled:pointer-events-none disabled:opacity-40",
        className
      )}
      {...rest}
    />
  );
}

/* ───────────── Gruppierte Listen (wie iOS-Einstellungen) ───────────── */

export function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section>
      {title && <h3 className="px-4 pb-1.5 text-[12px] font-medium uppercase tracking-wide text-label2">{title}</h3>}
      <div className="overflow-hidden rounded-xl bg-surface shadow-card [&>*+*]:border-t [&>*+*]:border-sep">
        {children}
      </div>
      {footer && <p className="px-4 pt-1.5 text-[12px] leading-snug text-label2">{footer}</p>}
    </section>
  );
}

export function Row({
  label,
  sub,
  children,
  className,
}: {
  label: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[46px] items-center justify-between gap-4 px-4 py-2", className)}>
      <div className="min-w-0">
        <div className="text-[14px]">{label}</div>
        {sub && <div className="text-[12px] leading-snug text-label2">{sub}</div>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

/* ───────────── Eingaben ───────────── */

export interface Opt<T> {
  value: T;
  label: string;
}

export function Select<T extends string | number>({
  value,
  options,
  groups,
  onChange,
  className,
}: {
  value: T;
  options?: Opt<T>[];
  groups?: { label: string; options: Opt<T>[] }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const all = options ?? groups?.flatMap((g) => g.options) ?? [];
  return (
    <div className={cn("relative inline-flex", className)}>
      <select
        value={String(value)}
        onChange={(e) => {
          const hit = all.find((o) => String(o.value) === e.target.value);
          if (hit) onChange(hit.value);
        }}
        className="h-8 max-w-[260px] cursor-default appearance-none truncate rounded-lg bg-fill py-0 pl-3 pr-8 text-[14px] transition hover:bg-fill2 focus:ring-2 focus:ring-accent/50"
      >
        {options?.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-label2" />
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  stretch = false,
}: {
  value: T;
  options: Opt<T>[];
  onChange: (v: T) => void;
  className?: string;
  stretch?: boolean;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  return (
    <div
      className={cn("relative grid rounded-[9px] bg-fill p-[2px]", stretch ? "w-full" : "w-fit", className)}
      style={{ gridAutoFlow: "column", gridAutoColumns: "1fr" }}
      role="tablist"
    >
      <div
        className="absolute bottom-[2px] top-[2px] rounded-[7px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] dark:bg-[#636366]"
        style={{
          left: 2,
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 whitespace-nowrap rounded-[7px] px-3.5 py-[5px] text-[13px] font-medium transition-colors",
            o.value === value ? "text-label" : "text-label2 hover:text-label"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40",
        checked ? "bg-ok" : "bg-fill2 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]"
      )}
    >
      <span
        className="absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25),0_0_0_0.5px_rgba(0,0,0,0.06)] transition-[left] duration-200 ease-out"
        style={{ left: checked ? 20 : 2 }}
      />
    </button>
  );
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className={cn("slider", className)}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ "--p": `${p}%` } as CSSProperties}
    />
  );
}

export function NumberField({
  value,
  onChange,
  min = 0,
  max = 999999,
  suffix,
  width = 84,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  width?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(text.replace(",", "."));
    if (Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    onChange(clamped);
    setText(String(clamped));
  };
  return (
    <div className="flex items-center gap-2">
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        style={{ width }}
        className="tnum h-8 rounded-lg bg-fill px-2.5 text-right text-[14px] transition hover:bg-fill2 focus:ring-2 focus:ring-accent/50"
      />
      {suffix && <span className="min-w-[34px] text-[13px] text-label2">{suffix}</span>}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <input
      id={id}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 w-44 rounded-lg bg-fill px-2.5 text-right text-[14px] transition hover:bg-fill2 focus:ring-2 focus:ring-accent/50",
        className
      )}
    />
  );
}

/* ───────────── Überlagerungen ───────────── */

export function Sheet({
  title,
  onClose,
  children,
  width = 560,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const getFocusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
        ) ?? []
      );
    if (!panel?.contains(document.activeElement)) panel?.focus({ preventScroll: true });

    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panel?.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => {
      window.removeEventListener("keydown", h);
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center p-5 backdrop-blur-[3px]"
      style={{ background: "var(--overlay)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="anim-sheet relative flex max-h-full w-full flex-col overflow-hidden rounded-[20px] bg-canvas shadow-pop outline-none"
        style={{ maxWidth: width }}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

export function useOutsideClick(ref: RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && cb.current();
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [ref, active]);
}

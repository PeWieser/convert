import type { ReactNode } from "react";
import type { PresetIcon as PresetIconId } from "../lib/types";
import { cn } from "../utils/cn";

/* Eigene Glyphen statt Standard-Icons – ruhig, präzise, unverwechselbar. */
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const GLYPHS: Record<PresetIconId, { tone: string; glyph: ReactNode }> = {
  smartphone: {
    tone: "from-[#8a8f98] to-[#3c4048]",
    glyph: (
      <>
        <rect x="7" y="2.5" width="10" height="19" rx="2.6" {...S} />
        <rect x="8.6" y="5" width="6.8" height="10.6" rx="0.6" fill="currentColor" opacity="0.32" />
        <circle cx="12" cy="18.6" r="1.05" {...S} strokeWidth={1.3} />
      </>
    ),
  },
  film: {
    tone: "from-[#4aa8ff] to-[#0866e8]",
    glyph: (
      <>
        <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="3.4" {...S} />
        <path d="M10.4 9.1v5.8l4.9-2.9z" fill="currentColor" />
      </>
    ),
  },
  tv: {
    tone: "from-[#b48cff] to-[#6d3fe0]",
    glyph: (
      <>
        <rect x="3" y="4.8" width="18" height="12" rx="2.4" {...S} />
        <path d="M9 20.2h6" {...S} />
      </>
    ),
  },
  music: {
    tone: "from-[#ff7a8f] to-[#e8264d]",
    glyph: (
      <>
        <path d="M9.2 17.4V6.6l9.3-2.1v10.9" {...S} />
        <circle cx="7.2" cy="17.4" r="2.1" {...S} />
        <circle cx="16.4" cy="15.4" r="2.1" {...S} />
      </>
    ),
  },
  globe: {
    tone: "from-[#4fd8c4] to-[#0e9f8c]",
    glyph: (
      <>
        <circle cx="12" cy="12" r="8.4" {...S} />
        <ellipse cx="12" cy="12" rx="3.6" ry="8.4" {...S} />
        <path d="M3.8 12h16.4" {...S} />
      </>
    ),
  },
  clapperboard: {
    tone: "from-[#7c8bff] to-[#3b3fd6]",
    glyph: (
      <>
        <rect x="3.5" y="9.4" width="17" height="10.4" rx="2.2" {...S} />
        <path d="M4 9.2 18.9 5.3M8.3 8.1l1.6 1.3M13.1 6.8l1.6 1.3" {...S} />
      </>
    ),
  },
  laptop: {
    tone: "from-[#9aa1ab] to-[#5b616b]",
    glyph: (
      <>
        <rect x="5" y="5.6" width="14" height="9.8" rx="1.6" {...S} />
        <path d="M2.8 18.6h18.4" {...S} />
      </>
    ),
  },
  sparkles: {
    tone: "from-[#ffcf4a] to-[#f29a00]",
    glyph: <path d="M12 3.6l1.9 5.2 5.2 1.9-5.2 1.9L12 17.8l-1.9-5.2-5.2-1.9 5.2-1.9z" fill="currentColor" />,
  },
};

export const PRESET_ICON_IDS = Object.keys(GLYPHS) as PresetIconId[];

export function PresetIcon({ icon, size = 40, className }: { icon: PresetIconId; size?: number; className?: string }) {
  const { tone, glyph } = GLYPHS[icon] ?? GLYPHS.film;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-linear-to-b text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.4),0_1px_2px_rgba(0,0,0,0.16)]",
        tone,
        className
      )}
      style={{ width: size, height: size, borderRadius: size * 0.27 }}
    >
      <svg viewBox="0 0 24 24" style={{ width: size * 0.6, height: size * 0.6 }} aria-hidden>
        {glyph}
      </svg>
    </span>
  );
}

/* Ruhiges Zahnrad im SF-Stil: 8 symmetrische Zähne, dünne Linie, optisch zentriert. */
function gearOutline(): string {
  const cx = 12;
  const cy = 12;
  const teeth = 8;
  const rTip = 8.6;
  const rRoot = 6.7;
  const tipHalf = (Math.PI / teeth) * 0.34;
  const rootHalf = (Math.PI / teeth) * 0.72;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    const seq: Array<[number, number]> = [
      [a - rootHalf, rRoot],
      [a - tipHalf, rTip],
      [a + tipHalf, rTip],
      [a + rootHalf, rRoot],
      [a + Math.PI / teeth, rRoot],
    ];
    for (const [ang, r] of seq) {
      const x = (cx + r * Math.cos(ang)).toFixed(2);
      const y = (cy + r * Math.sin(ang)).toFixed(2);
      pts.push(`${x},${y}`);
    }
  }
  return `M${pts.join("L")}Z`;
}

const GEAR_D = gearOutline();

export function GearGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <path
        d={GEAR_D}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.45}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.45" fill="none" stroke="currentColor" strokeWidth={1.45} />
    </svg>
  );
}

/* Drei Punkte (SF „ellipsis“) – öffnet das Menü eines Presets. */
export function DotsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <circle cx="5.5" cy="12" r="1.75" fill="currentColor" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.75" fill="currentColor" />
    </svg>
  );
}

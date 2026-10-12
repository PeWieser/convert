const nf1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["Bytes", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${nf0.format(v)} Bytes`;
  return `${v >= 100 || i === 1 ? nf0.format(v) : nf1.format(v)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "–";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** „noch 2 Min.“ */
export function formatRemaining(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "";
  if (seconds < 8) return "gleich fertig";
  if (seconds < 60) return `noch ${Math.round(seconds / 5) * 5} Sek.`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `noch ${m} Min.`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `noch ${h} Std.${rest ? ` ${rest} Min.` : ""}`;
}

export function resolutionLabel(w: number, h: number): string {
  const m = Math.min(w, h);
  if (m >= 2000) return "4K";
  if (m >= 1400) return "1440p";
  if (m >= 1000) return "1080p";
  if (m >= 700) return "720p";
  if (m >= 460) return "480p";
  if (m >= 340) return "360p";
  return `${w} × ${h}`;
}

export function formatNumber(n: number): string {
  return nf1.format(n);
}

export function plural(n: number, one: string, many: string): string {
  return `${nf0.format(n)} ${n === 1 ? one : many}`;
}

export function baseName(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

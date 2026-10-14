import type { SourceFile } from "./types";

/** Matching names, sizes and mtimes do not prove identity (e.g. two camera cards). */
export async function uniqueSources(current: SourceFile[], incoming: SourceFile[]): Promise<SourceFile[]> {
  const key = (s: SourceFile) => `${s.name}\0${s.file?.size ?? s.native?.size}\0${s.file?.lastModified ?? s.native?.lastModified}`;
  const buckets = new Map<string, SourceFile[]>();
  const remember = (s: SourceFile) => buckets.set(key(s), [...(buckets.get(key(s)) ?? []), s]);
  current.forEach(remember);
  const accepted: SourceFile[] = [];
  for (const s of incoming) {
    let duplicate = false;
    for (const other of buckets.get(key(s)) ?? []) {
      if (s.native && other.native) duplicate = s.id === other.id;
      else if (s.handle && other.handle) duplicate = await s.handle.isSameEntry(other.handle).catch(() => false);
      else duplicate = !!s.file && s.file === other.file;
      if (duplicate) break;
    }
    if (!duplicate) { accepted.push(s); remember(s); }
  }
  return accepted;
}

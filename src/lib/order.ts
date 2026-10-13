/**
 * Reihenfolge berechnen, ohne sie anzufassen.
 *
 * Beim Umsortieren bleibt die gezogene Karte im DOM an ihrem Platz und folgt dem
 * Zeiger. Die anderen rücken mit einer Verschiebung nach. Diese Funktion sagt,
 * wie viele Plätze eine Karte nach links oder rechts wandert.
 */

/**
 * @param index  ursprüngliche Stelle der Karte
 * @param from   ursprüngliche Stelle der gezogenen Karte
 * @param to     Zielstelle der gezogenen Karte, gezählt ohne sie selbst
 * @returns Plätze, um die sich diese Karte verschiebt (negativ = nach links)
 */
export function slotShift(index: number, from: number, to: number): number {
  /* Die gezogene Karte selbst wandert an die Zielstelle – der Rest macht Platz. */
  if (index === from) return to - from;
  const reduced = index < from ? index : index - 1;
  const slot = reduced < to ? reduced : reduced + 1;
  return slot - index;
}

/** Setzt eine Liste neu zusammen, wie es die Oberfläche meint: Zielstelle ohne das bewegte Element. */
export function moveTo<T>(list: T[], from: number, toIndex: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const rest = list.filter((_, i) => i !== from);
  const at = Math.max(0, Math.min(rest.length, toIndex));
  return [...rest.slice(0, at), list[from], ...rest.slice(at)];
}

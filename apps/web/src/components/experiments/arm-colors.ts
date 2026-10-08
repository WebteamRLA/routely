/**
 * The design's arm palette, by position: control first, then variants A–D, cycling after that.
 *
 * Kept in a plain module (not a "use client" one) so server components — the list rows, the
 * results page — and client components — the traffic editor — read the same table. A value
 * exported from a client module reaches a server component only as a reference, not a value.
 */
const ARM_BG = ["bg-arm-control", "bg-arm-a", "bg-arm-b", "bg-arm-c", "bg-arm-d"] as const;

/** Background class for the arm at `index`, where 0 is control. */
export function armBg(index: number): string {
  if (index <= 0) return ARM_BG[0];
  return ARM_BG[1 + ((index - 1) % (ARM_BG.length - 1))]!;
}

/** Path plus query of a URL for compact display, falling back to the raw string. */
export function displayPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

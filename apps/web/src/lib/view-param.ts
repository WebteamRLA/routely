/**
 * `?view=` — which of a screen's designed states to open in.
 *
 * Every screen in the design has named states ("loading", "createErrors", "e5:results"…). The
 * screens are mock-data only until the backend lands, so many of those states (a failed load,
 * an empty account) cannot be reached by using the page. Reading the state name from the URL
 * makes each one directly addressable for review, using the design's own names so a state can
 * be compared one-to-one with the reference.
 *
 * Unknown or missing values fall back to the screen's default state.
 */
export function readView<const T extends string>(
  value: string | string[] | undefined,
  views: readonly T[],
  fallback: T,
): T {
  const v = Array.isArray(value) ? value[0] : value;
  return v && (views as readonly string[]).includes(v) ? (v as T) : fallback;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Real preview links on the customer's own site: the page URL with
 * `?routely_preview=<experimentId>:<position>`. The SDK forces that arm (redirecting a Split URL
 * test to the arm's URL), applies it, and records nothing — see packages/sdk/src/preview.ts.
 *
 * The experiment must be saved: the config endpoint serves a previewed experiment by id, in any
 * status, so a draft previews exactly as it is stored.
 */
export const PREVIEW_PARAM = "routely_preview";

export function previewLink(url: string, experimentId: string, position: number): string {
  const raw = url.trim().replace(/\*/g, "");
  const value = `${experimentId}:${position}`;
  try {
    const u = new URL(raw);
    u.searchParams.delete(PREVIEW_PARAM);
    u.hash = "";
    const search = u.search ? `${u.search}&` : "?";
    return `${u.origin}${u.pathname}${search}${PREVIEW_PARAM}=${value}`;
  } catch {
    const base = raw.split("#")[0] ?? raw;
    return `${base}${base.includes("?") ? "&" : "?"}${PREVIEW_PARAM}=${value}`;
  }
}

/** Resolves an image change value (`https://…` or `/path`) against the page it applies to. */
export function resolveImageUrl(value: string, pageUrl: string): string | null {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/") && !v.startsWith("//")) {
    try {
      return new URL(v, pageUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether a value is a usable image change: an http(s) URL or a site-relative path. */
export function isImageValue(value: string): boolean {
  const v = value.trim();
  return /^https?:\/\/\S+$/i.test(v) || (v.startsWith("/") && !v.startsWith("//") && v.length > 1);
}

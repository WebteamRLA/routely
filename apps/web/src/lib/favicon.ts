/**
 * Finding a project's favicon — the pure half (`server/services/favicon.service.ts` fetches).
 *
 * Two decisions here are about safety rather than looks:
 *
 * - **No SVG.** The icon is served from Routely's own origin (`/api/favicon/<id>`), and an SVG is a
 *   document that can carry script. Opened directly, a customer's SVG would run with the
 *   dashboard's origin. Bitmaps cannot, so only bitmaps are offered.
 * - **The type comes from the bytes, not the remote `Content-Type`.** A server can label anything
 *   `image/png`. `sniffImageType` reads the file's signature, and the route serves that type with
 *   `nosniff`, so what reaches the browser is an image or nothing.
 */

/** The bitmap types an icon may be served as. */
export type IconType = "image/png" | "image/x-icon" | "image/gif" | "image/jpeg" | "image/webp";

/** Bytes are enough to recognise every type above; anything else is refused. */
export function sniffImageType(bytes: Uint8Array): IconType | null {
  const at = (i: number) => bytes[i];
  const starts = (...sig: number[]) => sig.every((b, i) => at(i) === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}

const LINK = /<link\b[^>]*>/gi;
const ATTR = /([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR)) {
    out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  return out;
}

/** The largest side named in `sizes` ("32x32 16x16" → 32); 0 when absent or unreadable. */
function largestSize(sizes: string | undefined): number {
  let best = 0;
  for (const m of (sizes ?? "").matchAll(/(\d+)\s*x\s*(\d+)/gi)) {
    best = Math.max(best, Number(m[1]), Number(m[2]));
  }
  return best;
}

/** How many URLs are worth trying for one site. */
export const MAX_ICON_CANDIDATES = 4;

/**
 * The icon URLs to try, best first: the page's own `<link rel="…icon…">` declarations — the
 * touch icon first (it is drawn for this size: 180px and crisp in a 40px tile), then the largest
 * declared — and `/favicon.ico` last, which browsers fall back to as well. SVG icons are skipped
 * (see the header), as are non-http(s) hrefs.
 */
export function faviconCandidates(html: string, pageUrl: string): string[] {
  const found: { url: string; rank: number }[] = [];
  for (const [tag] of html.matchAll(LINK)) {
    const attr = attributes(tag);
    const rel = (attr.rel ?? "").toLowerCase().split(/\s+/);
    if (!rel.some((r) => r === "icon" || r.startsWith("apple-touch-icon"))) continue;
    if (!attr.href || /svg/i.test(attr.type ?? "")) continue;

    let url: URL;
    try {
      url = new URL(attr.href, pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || /\.svgz?$/i.test(url.pathname)) continue;

    const touch = rel.some((r) => r.startsWith("apple-touch-icon"));
    found.push({ url: url.href, rank: (touch ? 1000 : 0) + largestSize(attr.sizes) });
  }

  const ordered = found.sort((a, b) => b.rank - a.rank).map((f) => f.url);
  try {
    ordered.push(new URL("/favicon.ico", pageUrl).href);
  } catch {
    // An unusable page URL has no fallback either.
  }
  return [...new Set(ordered)].slice(0, MAX_ICON_CANDIDATES);
}

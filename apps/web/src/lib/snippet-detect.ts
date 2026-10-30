/**
 * What a fetched page's HTML says about the Routely snippet. Pure, so the install check
 * (`pixel.service`) and the experiment tracking check (`tracking-check.service`) share one
 * definition of "installed".
 *
 * Looks for the **site id**, not the script URL: the id is what binds a page to a website, and it
 * is present however the tag was written — hand-pasted, injected by a plugin, reformatted by a
 * minifier, or passed as a tag-manager variable. The id is 128 random bits, so any occurrence is
 * this website's.
 */

export interface SnippetDetection {
  /** This website's site id appears in the page. */
  scriptFound: boolean;
  /** The anti-flicker block (`window.__routelyReveal`) appears in the page. */
  antiFlickerFound: boolean;
  /** A Routely tag is present, but for a different website — the commonest install mistake. */
  wrongSiteId: boolean;
  /** Every other project's site id the page carries, so a mismatch can name what was found
   * (a stale cached page often still holds an old snippet). */
  otherSiteIds: string[];
  /**
   * What delays this website's Routely code, when a page optimiser or consent tool has rewritten
   * its tag (or the anti-flicker block) so it runs only after the page shows — the code is
   * installed, but a redirect can no longer happen before the control page is seen. Null when the
   * tags load normally, or when the id was found somewhere other than a script tag.
   */
  delayedBy: string | null;
}

const ANY_ROUTELY_TAG = /data-site-id\s*=\s*["']?(rt_[0-9a-z]+)/gi;

export function detectSnippet(html: string, publicSiteId: string): SnippetDetection {
  const scriptFound = publicSiteId.length > 0 && html.includes(publicSiteId);
  const found = [...html.matchAll(ANY_ROUTELY_TAG)].map((m) => m[1]!.toLowerCase());
  const otherSiteIds = [...new Set(found)].filter((id) => id !== publicSiteId.toLowerCase());
  return {
    scriptFound,
    antiFlickerFound: html.includes("__routelyReveal"),
    wrongSiteId: !scriptFound && otherSiteIds.length > 0,
    otherSiteIds,
    delayedBy: scriptFound ? findDelay(html, publicSiteId) : null,
  };
}

const SCRIPT_OPEN = /<script\b[^>]*>/gi;

/** The first delay on this website's tracking tag, else on the anti-flicker block. */
function findDelay(html: string, publicSiteId: string): string | null {
  for (const match of html.matchAll(SCRIPT_OPEN)) {
    const tag = match[0];
    const inline = html.slice(match.index + tag.length, match.index + tag.length + 400);
    const ours = tag.includes(publicSiteId) || /__routelyReveal|routelyTimeout/.test(inline);
    if (!ours) continue;
    const delay = tagDelay(tag);
    if (delay) return delay;
  }
  return null;
}

/**
 * Names what has rewritten one `<script>` opening tag to run late. The rewrites recognised are
 * the ones seen on customer sites: LiteSpeed Cache's "Delay/Load JS deferred"
 * (`type="litespeed/javascript"` + `data-src`), WP Rocket's "Delay JavaScript execution"
 * (`type="rocketlazyloadscript"` / `data-rocket-src`), consent tools that park scripts as
 * `type="text/plain"` until accepted, any other non-JavaScript `type`, a `data-src` with no `src`,
 * and `defer`. `async` is not a delay: the install snippet uses it, behind the anti-flicker cover.
 */
export function tagDelay(tag: string): string | null {
  const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? null;
  if (type === "litespeed/javascript") return "LiteSpeed Cache";
  if (type === "rocketlazyloadscript" || /\sdata-rocket-src\s*=/i.test(tag)) return "WP Rocket";
  if (type === "text/plain") return "A cookie-consent tool";
  if (type && !["text/javascript", "application/javascript", "module"].includes(type)) {
    return "A page optimisation plugin";
  }
  if (/\sdata-src\s*=/i.test(tag) && !/\ssrc\s*=/i.test(tag)) return "A page optimisation plugin";
  if (/\sdefer(?=[\s>=/])/i.test(tag)) return "The script’s defer attribute";
  return null;
}

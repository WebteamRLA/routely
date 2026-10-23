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
  };
}

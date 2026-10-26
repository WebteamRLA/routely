import "server-only";

import { EDITOR_HASH_PARAM } from "@routely/sdk/contract";

import type { EditorSession } from "@/lib/editor-protocol";
import { pageOrigin } from "@/lib/editor-token";
import { pageKey, sameSiteMessage, withScheme } from "@/lib/launch-rules";
import { isSameSite } from "@/lib/url";
import { separateProxyOrigin } from "@/server/editor-proxy";
import { mintEditorToken } from "@/server/editor-token";
import { rateLimited, validationFailed } from "@/server/errors";
import { rateLimit } from "@/server/http/rate-limit";
import * as trackingCheckRepo from "@/server/repositories/tracking-check.repository";
import { getExperimentAccess } from "@/server/services/experiment.service";
import { parseOrThrow } from "@/server/validate";
import { editorTokenRequestSchema } from "@/validation/editor";

/**
 * Opening an A/B test's tested page in the visual editor (spec §4.2, D4).
 *
 * The editor frames — or, when the site forbids framing, pops up — the customer's real page with
 * `#_rt_edit=<token>`. This service decides which page and issues the token. It never fetches the
 * page: whether the snippet is there is proven by the page itself answering the editor's
 * handshake, which is the only check that cannot be stale.
 *
 * Saving is not here. The editor's changes reach the variant through the draft autosave
 * (`saveDraftAction` → `experiment.service.saveDraft`), validated by `validation/visual-change.ts`
 * like every other draft field — the token is not a credential for anything.
 */

export type { EditorSession };

/** Editor sessions a user may open per minute. Generous: each "Try again" opens one. */
const TOKEN_RATE_LIMIT = 30;
const TOKEN_RATE_WINDOW_MS = 60_000;

/**
 * Issues an editor session for the experiment's stored tested page.
 *
 * Editor or above on the experiment's workspace (FORBIDDEN for a Viewer, NOT_FOUND for anyone
 * outside it). The page is the **stored** `controlUrl`, never a URL from the request: the token
 * binds that page's origin, and the page must be on the project's domain (the same-site rule every
 * experiment URL follows), so the editor can only ever be pointed at the customer's own site.
 */
export async function issueEditorSession(
  actorUserId: string,
  input: unknown,
): Promise<EditorSession> {
  const { experimentId } = parseOrThrow(editorTokenRequestSchema, input);

  if (!rateLimit(`editor-token:${actorUserId}`, TOKEN_RATE_LIMIT, TOKEN_RATE_WINDOW_MS).allowed) {
    throw rateLimited("Too many attempts to open the visual editor. Wait a minute and try again.");
  }

  const { experiment } = await getExperimentAccess(actorUserId, experimentId, "experiment.edit");
  const { website } = experiment;

  if (experiment.type !== "AB_TEST") {
    throw validationFailed("Only A/B tests use the visual editor.");
  }

  const stored = experiment.controlUrl ?? "";
  const key = pageKey(stored);
  if (!key) {
    throw validationFailed(
      "Enter a valid page URL to view the original page and open the visual editor.",
    );
  }
  const pageUrl = withScheme(stored);
  if (!isSameSite(pageUrl, website.domain)) throw validationFailed(sameSiteMessage(website.domain));

  const origin = pageOrigin(pageUrl);
  if (!origin) {
    throw validationFailed(
      "Enter a valid page URL to view the original page and open the visual editor.",
    );
  }

  const { token, expiresAt } = mintEditorToken({
    experimentId: experiment.id,
    websiteId: website.id,
    userId: actorUserId,
    origin,
  });

  const frame = new URL(pageUrl);
  frame.hash = `${EDITOR_HASH_PARAM}=${token}`;

  const [check] = await trackingCheckRepo.findTrackingChecks(website.id, [key]);
  const snippet = !check
    ? "unknown"
    : check.result === "OK"
      ? "found"
      : check.result === "MISSING"
        ? "missing"
        : "unknown";

  const pageHref = frame.href.split("#")[0] as string;
  // Relative unless a separate proxy host is configured: served beside the dashboard, on whatever
  // origin it was opened on (`server/editor-proxy.ts`).
  const proxyUrl =
    `${separateProxyOrigin() ?? ""}/api/editor/proxy?u=${encodeURIComponent(pageHref)}&t=${encodeURIComponent(token)}` +
    `#${EDITOR_HASH_PARAM}=${token}`;

  return {
    token,
    expiresAt: expiresAt * 1000,
    pageUrl: pageHref,
    frameUrl: frame.href,
    origin,
    proxyUrl,
    snippet,
  };
}

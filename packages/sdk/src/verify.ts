import type { VerifySignal } from "./contract";
import { SDK_PROTOCOL_VERSION, VERIFY_HASH_PARAM } from "./contract";
import { readEditorToken } from "./editor-bridge";
import { post } from "./track";

/**
 * Install verification: when Routely's dashboard opens a page with `#_rt_verify=<token>`, the SDK
 * says what happened to it, on two channels (see `VerifySignal`).
 *
 * The token proves nothing about the visitor and grants nothing: it only says which check this
 * answer belongs to. The message to the opener carries no token, which is why it can be addressed
 * to any origin — the dashboard may be on a different one than the API.
 */

export const SDK_VERSION = "0.2.0";

export function readVerifyToken(href: string): string | null {
  return readEditorToken(href, VERIFY_HASH_PARAM);
}

/** This SDK's id first, then every other tag on the page; repeats kept, so two tags show as two. */
export function pageSiteIds(own: string): string[] {
  const ids = [own];
  let skipped = false;
  document.querySelectorAll<HTMLScriptElement>("script[data-site-id]").forEach((script) => {
    const id = script.dataset.siteId ?? "";
    if (id === own && !skipped) skipped = true;
    else if (id) ids.push(id);
  });
  return ids;
}

export function reportVerify(
  apiBase: string,
  token: string,
  stage: VerifySignal["stage"],
  siteIds: string[],
  reason?: VerifySignal["reason"],
): void {
  const signal: VerifySignal = {
    v: SDK_PROTOCOL_VERSION,
    token,
    stage,
    siteIds,
    url: window.location.href.split("#")[0]!,
    sdk: SDK_VERSION,
    ...(reason ? { reason } : {}),
  };
  post(apiBase + "/api/v1/verify", signal);

  try {
    window.opener?.postMessage({ type: "routely:verify", stage, reason, siteIds }, "*");
  } catch {
    // A severed opener only costs the dashboard the browser-side half of the answer.
  }
}

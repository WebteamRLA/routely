"use server";

import type { UrlCheckResult } from "@/lib/view-models";
import { type ActionResult, runResult } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import * as urlCheckService from "@/server/services/url-check.service";

/**
 * Wizard URL check: is this URL reachable, is it on one of the project's domains, and (for
 * pages on those domains) is the snippet there. An unreachable URL is a successful *check*
 * with `ok: false`; `status: "error"` means the check itself was refused (rate limit, not your
 * project).
 */
export async function checkUrlAction(input: {
  projectId: string;
  url: string;
}): Promise<ActionResult<UrlCheckResult>> {
  const user = await requireUser();
  return runResult(() => urlCheckService.checkUrl(user.id, input.projectId, input.url));
}

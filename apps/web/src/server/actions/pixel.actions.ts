"use server";

import { runAction } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import * as pixelService from "@/server/services/pixel.service";

/**
 * Server Action for the install panel's page check (is the snippet on this page?).
 *
 * The check is a server-side fetch of a page the customer names, looking for the snippet in
 * the returned HTML. That is deliberately independent of whether any tracking data has
 * arrived: the SDK only reports events once an **active experiment matches the page being
 * viewed**, so a data-based check could not pass until a test already existed — which is the
 * wrong way round for a step whose whole job is confirming the install before that point.
 */
/**
 * Result of the pre-publish install check, shaped for a client component to render directly.
 *
 * Everything is plain data because this crosses the server/client boundary, and a thrown
 * `AppError` would arrive as `{}` — so a failure is returned as a value rather than raised.
 */
export type InstallCheckResult =
  { ok: true; snippetFound: boolean; wrongSiteId: boolean } | { ok: false; message: string };

/**
 * Checks one page for the snippet, for the wizard's pre-publish dialog.
 *
 * Called directly rather than through a form, because it runs when the dialog opens instead of
 * on a submission. Never throws: the dialog treats a failed check as "could not confirm",
 * which is advisory and must not block creating a draft.
 */
export async function checkInstallOnPageAction(input: {
  websiteId: string;
  url: string;
}): Promise<InstallCheckResult> {
  const user = await requireUser();

  const result = await runAction(() => pixelService.verifyInstallation(user.id, input));

  if (!result.ok) {
    return { ok: false, message: result.state.message ?? "We couldn't check that page." };
  }

  return {
    ok: true,
    snippetFound: result.data.snippetFound,
    wrongSiteId: result.data.wrongSiteId,
  };
}

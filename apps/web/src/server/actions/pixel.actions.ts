"use server";

import { revalidatePath } from "next/cache";

import { routes } from "@/lib/routes";
import { type FormState, runAction } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import * as pixelService from "@/server/services/pixel.service";

/**
 * Server Action for the Get started guide's "Verify installation" step.
 *
 * The check is a server-side fetch of a page the customer names, looking for the snippet in
 * the returned HTML. That is deliberately independent of whether any tracking data has
 * arrived: the SDK only reports events once an **active experiment matches the page being
 * viewed**, so a data-based check could not pass until a test already existed — which is the
 * wrong way round for a step whose whole job is confirming the install before that point.
 *
 * Whether data has arrived is still reported, as the second half of the picture rather than
 * the gate.
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

  if (!result.data.pageLoaded) {
    return { ok: false, message: result.data.loadError ?? "We couldn't load that page." };
  }

  return {
    ok: true,
    snippetFound: result.data.scriptFound,
    wrongSiteId: result.data.wrongSiteId,
  };
}

export async function verifyPixelAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const result = await runAction(() =>
    pixelService.verifyInstallation(user.id, {
      websiteId: formData.get("websiteId"),
      url: formData.get("url"),
    }),
  );

  if (!result.ok) {
    return result.state;
  }

  const { pageLoaded, loadError, scriptFound, wrongSiteId, lastSeenAt } = result.data;

  if (!pageLoaded) {
    return {
      status: "error",
      message: `${loadError ?? "We couldn't load that page."} We need a page we can load to check it.`,
    };
  }

  if (!scriptFound) {
    return {
      status: "error",
      message: wrongSiteId
        ? "We found a Routely snippet on that page, but it carries a different website's site id. Copy the snippet from this page and replace it."
        : "We loaded that page but couldn't find your snippet in it. Check it's saved in the <head>, and that any caching plugin has been cleared.",
    };
  }

  revalidatePath(routes.getStarted);

  return {
    status: "success",
    message: lastSeenAt
      ? "Snippet found, and we're receiving tracking data."
      : "Snippet found. No page views reported yet — they arrive as soon as someone visits a page with the snippet.",
  };
}

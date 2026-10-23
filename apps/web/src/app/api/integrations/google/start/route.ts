import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { sanitizeReturnTo } from "@/lib/google-oauth-state";
import { can } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import { outcomeQuery } from "@/lib/sheets-card";
import { getSession } from "@/server/auth/session";
import { isSecretStorageConfigured } from "@/server/crypto";
import { findWebsiteAccess } from "@/server/repositories/website.repository";
import * as googleOAuth from "@/server/services/google-oauth.service";

/**
 * Starts the Google Sheets consent flow.
 *
 * The Prisma adapter is a Node database driver, so this cannot run on the Edge runtime.
 */
export const runtime = "nodejs";

/** Ids are cuid-shaped; anything else in the form is ignored rather than looked up. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * **POST, deliberately.** A GET here would be followed by a link prefetch, a crawler, or a
 * `<img>` tag, each of which would mint state and set a cookie without the customer having asked
 * for anything. Requiring a form submission means the flow can only begin from a real interaction.
 *
 * The form may carry a `websiteId` — the project dashboard's Connect button does. Then the grant
 * goes to **that project's** workspace and the callback returns to the project; otherwise it goes
 * to the active workspace and returns to Integrations. Both are decided here and sealed into the
 * signed state, so nothing on the way back can change them.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();

  // Not a redirect to /login with a callbackUrl: this is a POST, so there is no way to replay it
  // after signing in. Sending them to the page the button lives on is the honest outcome.
  if (!session) {
    return NextResponse.redirect(new URL(routes.login, request.url), { status: 303 });
  }

  let workspaceId = session.user.workspaceId;
  let role = session.user.role;
  let returnTo: string = routes.integrations;

  const form = await request.formData().catch(() => null);
  const websiteId = form?.get("websiteId");

  if (typeof websiteId === "string" && ID_PATTERN.test(websiteId)) {
    const access = await findWebsiteAccess(websiteId, session.user.id);

    // A project the actor cannot see is treated as absent: they land on Integrations, which acts on
    // their own active workspace — never on the workspace of an id they guessed.
    if (access) {
      workspaceId = access.website.workspaceId;
      role = access.role;
      returnTo = routes.projects.detail(access.website.id);
    }
  }

  returnTo = sanitizeReturnTo(returnTo);
  const back = (outcome: Parameters<typeof outcomeQuery>[0]) =>
    NextResponse.redirect(new URL(`${returnTo}?${outcomeQuery(outcome)}`, request.url), {
      status: 303,
    });

  if (!googleOAuth.isGoogleOAuthConfigured() || !isSecretStorageConfigured()) {
    return back("not_configured");
  }

  // Connecting is Owner/Admin. Checked here so a Viewer is told so before visiting Google, and
  // again in `completeConnection`, which is the check that counts.
  if (!can(role, "sheets.manage")) return back("forbidden");

  const { state, nonce } = googleOAuth.mintState(session.user.id, { workspaceId, returnTo });

  const store = await cookies();
  store.set(googleOAuth.STATE_COOKIE, nonce, {
    httpOnly: true,
    // `lax`, not `strict`. The callback arrives as a cross-site top-level navigation from
    // accounts.google.com, and `strict` would withhold the cookie on exactly that request —
    // making every connection attempt fail the nonce check.
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/api/integrations/google",
    maxAge: 600,
  });

  // 303 so the browser follows with a GET rather than re-POSTing to Google.
  return NextResponse.redirect(googleOAuth.authorizeUrl(state, session.user.email), {
    status: 303,
  });
}

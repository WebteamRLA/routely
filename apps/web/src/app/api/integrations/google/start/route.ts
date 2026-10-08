import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { LAST_PROJECT_COOKIE, routes } from "@/lib/routes";
import { getSession } from "@/server/auth/session";
import * as googleOAuth from "@/server/services/google-oauth.service";

/**
 * Starts the Google Sheets consent flow.
 *
 * The Prisma adapter is a Node database driver, so this cannot run on the Edge runtime.
 */
export const runtime = "nodejs";

/**
 * **POST, deliberately.** A GET here would be followed by a link prefetch, a crawler, or a
 * `<img>` tag, each of which would mint state and set a cookie without the customer having asked
 * for anything. Requiring a form submission means the flow can only begin from a real interaction.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();

  // Not a redirect to /login with a callbackUrl: this is a POST, so there is no way to replay it
  // after signing in. Sending them to the page the button lives on is the honest outcome.
  if (!session) {
    return NextResponse.redirect(new URL(routes.login, request.url), { status: 303 });
  }

  if (!googleOAuth.isGoogleOAuthConfigured()) {
    const projectId = (await cookies()).get(LAST_PROJECT_COOKIE)?.value;
    const target = projectId
      ? routes.project(projectId).integrations()
      : routes.currentIntegrations;
    return NextResponse.redirect(new URL(`${target}?error=not_configured`, request.url), {
      status: 303,
    });
  }

  const { state, nonce } = googleOAuth.mintState(session.user.id);

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

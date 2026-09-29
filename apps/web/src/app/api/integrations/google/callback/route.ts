import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { routes } from "@/lib/routes";
import { getSession } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as googleOAuth from "@/server/services/google-oauth.service";
import { completeConnection } from "@/server/services/sheets-sync.service";

/** The Prisma adapter is a Node database driver, so this cannot run on the Edge runtime. */
export const runtime = "nodejs";

/**
 * Completes the Google Sheets consent flow.
 *
 * Every outcome ends as a redirect back to `/integrations` carrying a short code, which the page
 * turns into a message. Nothing is rendered here: this URL is reached by a redirect from Google
 * and its content would be discarded anyway, and a redirect means the authorization code does not
 * linger in the address bar.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const back = (outcome: string): NextResponse =>
    NextResponse.redirect(new URL(`${routes.integrations}?${outcome}`, request.url), {
      status: 303,
    });

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL(routes.login, request.url), { status: 303 });

  const store = await cookies();
  const cookieNonce = store.get(googleOAuth.STATE_COOKIE)?.value;

  // Consumed whatever happens, so a state value can never be replayed.
  store.delete({ name: googleOAuth.STATE_COOKIE, path: "/api/integrations/google" });

  const params = request.nextUrl.searchParams;
  const error = params.get("error");

  // The customer pressed Cancel on Google's screen. Not a failure worth an alarming message.
  if (error === "access_denied") return back("error=denied");
  if (error) return back("error=google");

  const code = params.get("code");
  const state = params.get("state");

  if (!code || !state) return back("error=invalid");

  /*
   * The state check is bound to the *current session's* user id as well as to the cookie. The
   * signature proves the state came from us and the cookie proves it came back through the browser
   * that started the flow; binding the user id is what stops an attacker starting a flow, handing
   * the URL to a victim, and having the victim's Google account attached to the attacker's account.
   */
  if (!googleOAuth.verifyState(state, cookieNonce, session.user.id)) {
    return back("error=state");
  }

  try {
    await completeConnection(session.user.id, code);
  } catch (caught) {
    // The message is shown to the customer, so only AppError messages — which are written for
    // them — are passed through. Anything else becomes a generic failure and is logged.
    if (isAppError(caught)) {
      return back(`error=connect&detail=${encodeURIComponent(caught.message)}`);
    }

    console.error("[routely] google sheets connect failed:", caught);
    return back("error=connect");
  }

  return back("connected=1");
}

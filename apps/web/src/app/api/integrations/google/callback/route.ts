import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { unverifiedReturnTo, withOutcome } from "@/lib/google-oauth-state";
import { routes } from "@/lib/routes";
import { type SheetsOutcomeReason, outcomeQuery } from "@/lib/sheets-card";
import { getSession } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as googleOAuth from "@/server/services/google-oauth.service";
import { completeConnection } from "@/server/services/sheets-sync.service";

/** The Prisma adapter is a Node database driver, so this cannot run on the Edge runtime. */
export const runtime = "nodejs";

/**
 * Completes the Google Sheets consent flow.
 *
 * Every outcome ends as a redirect to the state's `returnTo` — the Integrations page or the project
 * dashboard the flow began on — carrying a short **code** (`?sheets=connected`, or
 * `?sheets=error&reason=…`), which the page turns into a message. Only codes travel in the URL, never
 * a message, so nobody can craft a link that makes our page say something we did not write.
 *
 * Nothing is rendered here: this URL is reached by a redirect from Google, and a redirect means the
 * authorization code does not linger in the address bar.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL(routes.login, request.url), { status: 303 });

  const store = await cookies();
  const cookieNonce = store.get(googleOAuth.STATE_COOKIE)?.value;

  // Consumed whatever happens, so a state value can never be replayed.
  store.delete({ name: googleOAuth.STATE_COOKIE, path: "/api/integrations/google" });

  const params = request.nextUrl.searchParams;
  const state = params.get("state");

  /*
   * The state check is bound to the *current session's* user id as well as to the cookie. The
   * signature proves the state (including its workspace and returnTo) came from us and the cookie
   * proves it came back through the browser that started the flow; binding the user id is what
   * stops an attacker starting a flow, handing the URL to a victim, and having the victim's Google
   * account attached to the attacker's workspace.
   */
  const verified = state ? googleOAuth.verifyState(state, cookieNonce, session.user.id) : null;

  // Before verification, only the allow-listed path from the payload is used — at worst a forged
  // state picks which of our own two pages shows the error.
  const returnTo = verified?.returnTo ?? unverifiedReturnTo(state);
  const back = (outcome: "connected" | SheetsOutcomeReason): NextResponse =>
    NextResponse.redirect(new URL(withOutcome(returnTo, outcomeQuery(outcome)), request.url), {
      status: 303,
    });

  const error = params.get("error");

  // The customer pressed Cancel on Google's screen. Not a failure worth an alarming message.
  if (error === "access_denied") return back("denied");
  if (error) return back("google");

  const code = params.get("code");
  if (!code || !state) return back("invalid");
  if (!verified) return back("state");

  try {
    await completeConnection(session.user.id, verified.workspaceId, code);
  } catch (caught) {
    if (isAppError(caught)) {
      if (caught.code === "FORBIDDEN" || caught.code === "NOT_FOUND") return back("forbidden");
      if (caught.cause === "missing_scope") return back("scope");
      if (caught.cause === "no_refresh_token") return back("refresh");
      console.error("[routely] google sheets connect failed:", caught.message);
      return back("connect");
    }

    console.error("[routely] google sheets connect failed:", caught);
    return back("connect");
  }

  return back("connected");
}

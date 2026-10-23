import { type NextRequest, NextResponse } from "next/server";

import { routes } from "@/lib/routes";
import { confirmEmailChange } from "@/server/services/account.service";

/**
 * `GET /settings/email/confirm?token=…` — the link in "Confirm your new email".
 *
 * Needs no session: following the link proves control of the new inbox, which is the only thing
 * being confirmed (it may well be opened on a phone that was never signed in). The outcome is
 * reported to Settings through `?emailChanged=`; signed out, proxy sends the visitor to sign in
 * first and back afterwards.
 *
 * A GET with a side effect, because that is what an emailed link is. The token is single-use and
 * only consumable once, so a mail scanner that prefetches the link confirms the change on the
 * owner's behalf — the same thing the owner was about to do — and cannot do anything else.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const outcome = await confirmEmailChange(token);
  const status = outcome === "changed" ? "1" : outcome;

  const target = new URL(routes.settings, request.nextUrl.origin);
  target.searchParams.set("emailChanged", status);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

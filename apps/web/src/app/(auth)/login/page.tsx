import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginView } from "@/components/auth/login-view";
import { describeAuthError } from "@/lib/auth-errors";
import { env } from "@/env";
import {
  LOGIN_VIEWS,
  PASSWORD_RESET,
  SIGN_IN_REQUIRED,
  authErrorCopy,
  viewError,
  type LoginMessage,
  type LoginPhase,
} from "@/lib/mock/login";
import { AFTER_SIGN_IN } from "@/lib/routes";
import { readView } from "@/lib/view-param";
import { signInWithGoogle } from "@/server/auth/actions";
import { getSession, isAuthConfigured } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

/** Only same-site relative paths survive; see the matching guard in the sign-in action. */
function safeCallbackUrl(value: string | undefined): string {
  if (!value) return AFTER_SIGN_IN;
  return value.startsWith("/") && !value.startsWith("//") ? value : AFTER_SIGN_IN;
}

/**
 * Sign-in screen.
 *
 * The real inputs map onto the design's states: arriving with `?callbackUrl=` (proxy stopped the
 * visitor on the way somewhere) is "signInRequired", and an Auth.js `?error=` is one of the
 * design's error states where one fits, or `describeAuthError`'s explanation where none does.
 * `?view=` opens any designed state directly, including the mock-only Google round trip.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; view?: string; reset?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  const callbackUrl = safeCallbackUrl(params.callbackUrl);

  // Someone who is already signed in has no business on the login screen.
  if (session) {
    redirect(callbackUrl);
  }

  const view = readView(params.view, LOGIN_VIEWS, "idle");
  const phase: LoginPhase =
    view === "waiting" || view === "signingIn" || view === "success" ? view : "idle";

  let error: LoginMessage | null = viewError(view);
  if (!error && params.error) {
    const known = authErrorCopy(params.error);
    const fallback = describeAuthError(params.error);
    error = known ?? (fallback ? { title: fallback.title, body: fallback.description } : null);
  }

  const configured = isAuthConfigured();
  if (!error && !configured) {
    error = {
      title: "Google sign-in is not configured",
      body: "Sign in with your email and password below, or set AUTH_SECRET, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in apps/web/.env.",
    };
  }

  const notice =
    params.reset === "1"
      ? { ...PASSWORD_RESET, tone: "success" as const }
      : view === "signInRequired" || params.callbackUrl !== undefined
        ? SIGN_IN_REQUIRED
        : null;

  return (
    <LoginView
      key={view}
      action={signInWithGoogle}
      callbackUrl={callbackUrl}
      phase={phase}
      notice={notice}
      error={error}
      disabled={!configured}
      supportEmail={env.SUPPORT_EMAIL ?? null}
    />
  );
}

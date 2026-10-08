import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/login/google-sign-in-button";
import { Banner } from "@/components/rl";
import { describeAuthError } from "@/lib/auth-errors";
import { AFTER_SIGN_IN } from "@/lib/routes";
import { signInWithGoogle } from "@/server/auth/actions";
import { getSession, isAuthConfigured } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

/** Only same-site relative paths survive; see the matching guard in the sign-in action. */
function safeCallbackUrl(value: string | undefined): string {
  if (!value) return AFTER_SIGN_IN;
  return value.startsWith("/") && !value.startsWith("//") ? value : AFTER_SIGN_IN;
}

/**
 * Sign-in screen — the design's form column, with Google as the only method (the locked stack
 * is Auth.js + Google OAuth, so the prototype's email/password fields have no backend).
 *
 * Conditional notices (signed out, redirected, an auth error, missing configuration) sit above
 * the button so they are read before acting.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; signedOut?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  const callbackUrl = safeCallbackUrl(params.callbackUrl);

  // Someone who is already signed in has no business on the login screen.
  if (session) redirect(callbackUrl);

  const configured = isAuthConfigured();
  const authError = describeAuthError(params.error);
  const wasRedirected = callbackUrl !== AFTER_SIGN_IN;

  return (
    <>
      <div>
        <h1 className="mb-1.5 font-heading text-[26px] font-bold tracking-[-0.02em]">Sign in</h1>
        <div className="text-ink-3">Welcome back. Pick up where your experiments left off.</div>
      </div>

      {params.signedOut ? (
        <Banner tone="info" className="rounded-md px-3 py-2.5 text-[13px] font-bold">
          You’ve been signed out.
        </Banner>
      ) : wasRedirected ? (
        <Banner tone="info" className="rounded-md px-3 py-2.5 text-[13px] font-bold">
          Sign in to continue to the page you were opening.
        </Banner>
      ) : null}

      {authError ? (
        <div
          role="alert"
          className="rounded-md border border-danger-border bg-danger-bg px-3 py-2.5 text-[13px] text-danger-text"
        >
          <div className="font-extrabold">{authError.title}</div>
          <div className="mt-0.5">{authError.description}</div>
        </div>
      ) : null}

      {!configured ? (
        <div className="rounded-md border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px] leading-normal text-warning-text">
          <div className="font-extrabold">Google sign-in is not configured</div>
          <div className="mt-0.5">
            Set <code className="font-mono text-xs">AUTH_SECRET</code>,{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> in{" "}
            <code className="font-mono text-xs">apps/web/.env</code>. To browse the dashboard
            without them, set <code className="font-mono text-xs">AUTH_DEV_BYPASS=true</code> — that
            flag is refused in production.
          </div>
        </div>
      ) : null}

      <form action={signInWithGoogle}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <GoogleSignInButton disabled={!configured} />
      </form>

      <div className="border-t border-border pt-3.5 text-[12.5px] leading-normal text-pretty text-ink-3">
        Sign in with your Google work account. New to Routely? Signing in creates your account — we
        read only your name, email address and profile picture.
      </div>
    </>
  );
}

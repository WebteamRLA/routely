import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
 * Sign-in screen.
 *
 * Reading order is heading → action → reassurance. Anything conditional — an error, a setup
 * notice — is inserted above the button so it is read before the user acts rather than after.
 *
 * The form sits directly on the column rather than inside a card, as in the design: the navy
 * panel beside it already separates the two halves.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  const callbackUrl = safeCallbackUrl(params.callbackUrl);

  // Someone who is already signed in has no business on the login screen.
  if (session) {
    redirect(callbackUrl);
  }

  const configured = isAuthConfigured();
  const authError = describeAuthError(params.error);

  // Arriving with a callbackUrl means the visitor was stopped on the way somewhere.
  const wasRedirected = callbackUrl !== AFTER_SIGN_IN;

  return (
    <>
      <header>
        {/* Not "Welcome back": with Google as the only method, signing in is also how an
            account is created, so a first-time visitor sees this heading too. */}
        <h1 className="mb-1.5 font-heading text-[26px] font-bold tracking-[-0.02em]">Sign in</h1>
        <p className="text-pretty text-ink-3">Manage your websites and redirect experiments.</p>
      </header>

      {wasRedirected ? (
        <div className="flex items-center gap-2.5 rounded-md bg-brand-tint-2 px-3 py-2.5 text-[13px] font-bold text-[#1F3FB0]">
          <span aria-hidden className="size-[7px] flex-none rotate-45 bg-brand" />
          Sign in to continue to the page you were opening.
        </div>
      ) : null}

      {authError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{authError.title}</AlertTitle>
          <AlertDescription>{authError.description}</AlertDescription>
        </Alert>
      ) : null}

      {!configured ? (
        <Alert className="border-warning-border bg-warning-bg text-warning-text">
          <AlertTitle>Google sign-in is not configured</AlertTitle>
          <AlertDescription className="text-warning-text/90">
            Set <code className="font-mono text-xs">AUTH_SECRET</code>,{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> in{" "}
            <code className="font-mono text-xs">apps/web/.env</code>. To browse the dashboard
            without them, set <code className="font-mono text-xs">AUTH_DEV_BYPASS=true</code> — that
            flag is refused in production.
          </AlertDescription>
        </Alert>
      ) : null}

      <form action={signInWithGoogle}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <GoogleSignInButton disabled={!configured} />
      </form>

      <p className="text-[13px] leading-normal text-ink-3">
        New to Routely? Signing in with Google creates your account — there is no separate sign-up,
        and no password to choose.
      </p>

      <p className="border-t border-border pt-3.5 text-[12.5px] leading-normal text-pretty text-ink-3">
        We read only your name, email address and profile picture, and use them to identify your
        account. Routely never posts to your Google account.
      </p>
    </>
  );
}

"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { AuthError } from "next-auth";

import { AFTER_SIGN_IN, routes } from "@/lib/routes";
import { signIn, signOut } from "@/server/auth";

/**
 * Server Actions for the authentication flow.
 *
 * These are the only places the application calls Auth.js `signIn`/`signOut` directly, so
 * redirect targets and error handling are decided once.
 */

/** Where to send the user after signing in, defaulting to their experiments. */
function safeCallbackUrl(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return AFTER_SIGN_IN;

  // Only same-site relative paths. `//evil.example` is a protocol-relative URL that a naive
  // `startsWith("/")` check would accept as internal.
  return value.startsWith("/") && !value.startsWith("//") ? value : AFTER_SIGN_IN;
}

/**
 * Starts the Google OAuth flow.
 *
 * `signIn` finishes by throwing a redirect, which Next.js catches and turns into a real
 * redirect response — so `unstable_rethrow` re-throws framework control-flow errors before
 * anything here mistakes one for a failure. A genuine `AuthError` becomes a `?error=`
 * parameter on the login page, which knows how to explain each case.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const callbackUrl = safeCallbackUrl(formData.get("callbackUrl"));

  try {
    await signIn("google", { redirectTo: callbackUrl });
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof AuthError) {
      console.error("[routely] sign-in failed", { type: error.type });
      redirect(`${routes.login}?error=${encodeURIComponent(error.type)}`);
    }

    throw error;
  }
}

/**
 * Ends the session.
 *
 * Under the database session strategy this deletes the `sessions` row, so the session is
 * revoked server-side rather than merely being forgotten by the browser.
 */
export async function signOutAction(): Promise<void> {
  // `?signedOut=1` lets the login screen say "You’ve been signed out."
  await signOut({ redirectTo: `${routes.login}?signedOut=1` });
}

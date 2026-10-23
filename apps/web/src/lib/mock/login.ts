/**
 * The sign-in screen's states and copy, from the design's `Login` screen.
 *
 * Lives outside the `"use client"` view so the server page can read `LOGIN_VIEWS` and map Auth.js
 * error codes before rendering.
 */

export const LOGIN_VIEWS = [
  "idle",
  "signedOut",
  "signInRequired",
  "waiting",
  "signingIn",
  "success",
  "errorCancelled",
  "errorBlocked",
  "errorNoAccess",
  "errorNetwork",
] as const;
export type LoginViewName = (typeof LOGIN_VIEWS)[number];

/** Where the Google round trip is. `waiting`/`signingIn`/`success` are reachable only by `?view=`. */
export type LoginPhase = "idle" | "waiting" | "signingIn" | "success";

export interface LoginMessage {
  title: string;
  body: string;
}

export const NOTE: Record<LoginPhase, string> = {
  idle: "",
  waiting: "Finish signing in in the Google window that just opened.",
  signingIn: "Google confirmed your account. Setting up your session…",
  success: "Google confirmed your account. Setting up your session…",
};

/** After a password reset — every session was signed out, so this one starts from the form. */
export const PASSWORD_RESET: LoginMessage = {
  title: "Password updated",
  body: "Sign in with your new password. Every other session was signed out.",
};

export const SIGN_IN_REQUIRED: LoginMessage = {
  title: "Sign in to continue",
  body: "Your session has ended. Sign in again to get back to your projects.",
};

/**
 * The design's four sign-in failures. `noAccess` names the account in the reference; Auth.js does
 * not tell the login page which account was refused, so a real refusal says "This Google account".
 */
export function errorCopy(
  code: "cancelled" | "blocked" | "noAccess" | "network",
  email?: string,
): LoginMessage {
  switch (code) {
    case "cancelled":
      return {
        title: "Google sign-in didn’t finish",
        body: "The Google window was closed before you finished signing in. Nothing was changed, so you can try again when you’re ready.",
      };
    case "blocked":
      return {
        title: "Your browser blocked the Google window",
        body: "Allow pop-ups for this site from your browser’s address bar, then continue with Google again.",
      };
    case "noAccess":
      return {
        title: "This Google account doesn’t have access",
        body: `${email ?? "This Google account"} isn’t a member of a Routely workspace. Ask your workspace admin to invite this address, or continue with a different Google account.`,
      };
    case "network":
      return {
        title: "We couldn’t reach Google",
        body: "Check your internet connection and try again. If it keeps happening, contact support.",
      };
  }
}

/** The error a design view opens with. */
export function viewError(view: LoginViewName): LoginMessage | null {
  if (view === "errorCancelled") return errorCopy("cancelled");
  if (view === "errorBlocked") return errorCopy("blocked");
  if (view === "errorNoAccess") return errorCopy("noAccess", "sam.rivera@gmail.com");
  if (view === "errorNetwork") return errorCopy("network");
  return null;
}

/**
 * Auth.js `?error=` codes mapped onto the design's error states where one fits. Anything else
 * returns null, and the page falls back to `describeAuthError`'s explanation.
 */
export function authErrorCopy(code: string): LoginMessage | null {
  // Google's consent screen was abandoned, or its response could not be completed.
  if (code === "OAuthCallbackError" || code === "OAuthCallback") return errorCopy("cancelled");
  // The sign-in callback refused this account.
  if (code === "AccessDenied") return errorCopy("noAccess");
  // The redirect to Google could not be started.
  if (code === "OAuthSignInError" || code === "OAuthSignin") return errorCopy("network");
  // Google returned an address that already has a Routely password account. Accounts are never
  // linked by email alone (`allowDangerousEmailAccountLinking: false`).
  if (code === "OAuthAccountNotLinked") {
    return {
      title: "This email already has a password",
      body: "Sign in with your email and password.",
    };
  }
  return null;
}

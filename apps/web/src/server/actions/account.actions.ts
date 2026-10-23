"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AFTER_SIGN_IN, routes } from "@/lib/routes";
import { startPasswordSession } from "@/server/auth/password-session";
import { requireUser } from "@/server/auth/session";
import { isAppError, toPublicError } from "@/server/errors";
import { clientAddress } from "@/server/http/rate-limit";
import * as account from "@/server/services/account.service";

/**
 * Server Actions for accounts: the sign-in, sign-up and password-reset forms, and Settings →
 * Profile & security / Notifications.
 *
 * Each one is a public HTTP endpoint. The Settings actions re-derive the actor from the session
 * and never take a user id from the caller; the only ids they accept (a session to sign out)
 * are filtered by the actor's id in the write itself.
 */

// --- Result shapes -----------------------------------------------------------------------------

/** For the auth pages' `useActionState` forms. Plain data — it crosses to the client. */
export interface AuthFormState {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echoed so a failed submission keeps what was typed (never a password). */
  values?: Record<string, string>;
}

/** For Settings, called directly from event handlers. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

function firstFieldErrors(error: unknown): Record<string, string> | undefined {
  if (!isAppError(error) || !error.fieldErrors) return undefined;
  const out: Record<string, string> = {};
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages[0]) out[key] = messages[0];
  }
  return out;
}

async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const { code, message } = toPublicError(error);
    const fieldErrors = firstFieldErrors(error);
    return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
  }
}

function failed(error: unknown, values?: Record<string, string>): AuthFormState {
  const { message } = toPublicError(error);
  const fieldErrors = firstFieldErrors(error);
  return {
    status: "error",
    // A field-level problem is shown beside the field; the banner is for everything else.
    ...(fieldErrors && Object.keys(fieldErrors).length ? { fieldErrors } : { message }),
    ...(values ? { values } : {}),
  };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Same-site relative paths only; `//evil.example` is a protocol-relative URL, not a path. */
function safeCallbackUrl(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : AFTER_SIGN_IN;
}

async function ip(): Promise<string> {
  return clientAddress(await headers());
}

// --- Sign-in / sign-up / reset -----------------------------------------------------------------

export async function signInWithPasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = text(formData, "email");
  const callbackUrl = safeCallbackUrl(text(formData, "callbackUrl"));

  try {
    const { userId } = await account.authenticatePassword(
      { email, password: text(formData, "password") },
      await ip(),
    );
    const { origin } = await startPasswordSession(userId);
    await account.noteSignIn(userId, origin);
  } catch (error) {
    return failed(error, { email });
  }

  redirect(callbackUrl);
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = text(formData, "name");
  const email = text(formData, "email");
  const invite = text(formData, "invite") || null;
  let target = safeCallbackUrl(text(formData, "callbackUrl"));

  try {
    const { userId, joinedWorkspace } = await account.signUp(
      { name, email, password: text(formData, "password") },
      invite,
      await ip(),
    );
    const { origin } = await startPasswordSession(userId);
    await account.noteSignIn(userId, origin);
    // An invite this account could not use (sent to another address, or no longer valid): its page
    // explains why, rather than the dashboard silently showing a workspace the user didn't expect.
    if (invite && !joinedWorkspace) target = `/invite/${encodeURIComponent(invite)}`;
  } catch (error) {
    return failed(error, { name, email });
  }

  redirect(target);
}

export async function requestPasswordResetAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = text(formData, "email");
  try {
    await account.requestPasswordReset({ email }, await ip());
  } catch (error) {
    return failed(error, { email });
  }
  return {
    status: "success",
    message: "If an account exists for that address, we’ve sent a reset link.",
    values: { email },
  };
}

export async function resetPasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    await account.resetPassword(text(formData, "token"), {
      password: text(formData, "password"),
      confirm: text(formData, "confirm"),
    });
  } catch (error) {
    return failed(error);
  }
  redirect(`${routes.login}?reset=1`);
}

// --- Settings ----------------------------------------------------------------------------------

export async function updateProfileAction(input: {
  name: string;
  email: string;
}): Promise<ActionResult<account.ProfileResult>> {
  return run(async () => {
    const user = await requireUser();
    const result = await account.updateProfile(user.id, user.workspaceId, {
      name: input?.name,
      email: input?.email,
    });
    // The sidebar shows the name.
    revalidatePath("/", "layout");
    return result;
  });
}

export async function resendVerificationAction(): Promise<ActionResult<{ email: string }>> {
  return run(async () => account.resendVerification((await requireUser()).id));
}

export async function resendEmailChangeAction(): Promise<ActionResult<{ pendingEmail: string }>> {
  return run(async () => account.resendEmailChange((await requireUser()).id));
}

export async function cancelEmailChangeAction(): Promise<ActionResult<{ savedEmail: string }>> {
  return run(async () => account.cancelEmailChange((await requireUser()).id));
}

export async function changePasswordAction(input: {
  current: string;
  next: string;
  confirm: string;
}): Promise<ActionResult<{ passwordNote: string }>> {
  return run(async () => {
    const user = await requireUser();
    return account.changePassword(user.id, {
      current: input?.current,
      next: input?.next,
      confirm: input?.confirm,
    });
  });
}

export async function revokeSessionAction(
  sessionId: string,
): Promise<ActionResult<{ device: string }>> {
  return run(async () => {
    const user = await requireUser();
    return account.revokeSession(user.id, user.sessionId, sessionId);
  });
}

export async function revokeOtherSessionsAction(): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const user = await requireUser();
    return account.revokeOtherSessions(user.id, user.sessionId);
  });
}

export async function setNotificationPreferenceAction(
  kind: string,
  enabled: boolean,
): Promise<ActionResult<null>> {
  return run(async () => {
    const user = await requireUser();
    await account.setNotificationPreference(user.id, kind, enabled);
    return null;
  });
}

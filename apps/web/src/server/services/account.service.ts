import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { env } from "@/env";
import { Prisma } from "@/generated/prisma/client";
import type { NotificationKind } from "@/generated/prisma/enums";
import {
  ROLE_LABEL,
  type AccountSettings,
  passwordNote,
  sessionWhen,
  sessionWhere,
} from "@/lib/account";
import { NOTIFICATION_KINDS, NOTIFICATION_SETTINGS } from "@/lib/notifications";
import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from "@/lib/password";
import { routes } from "@/lib/routes";
import { parseUserAgent } from "@/lib/user-agent";
import { createPersonalWorkspace } from "@/server/auth/workspace";
import { db } from "@/server/db";
import { type EmailMessage, sendEmailAfter } from "@/server/email/resend";
import {
  confirmEmailChangeTemplate,
  emailChangedTemplate,
  newSignInTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from "@/server/email/templates";
import { appLink } from "@/server/email/templates/notifications";
import { AppError, conflict, notFound, rateLimited, validationFailed } from "@/server/errors";
import { rateLimit } from "@/server/http/rate-limit";
import * as tokens from "@/server/repositories/account-token.repository";
import * as devices from "@/server/repositories/known-device.repository";
import * as prefs from "@/server/repositories/notification-preference.repository";
import * as sessions from "@/server/repositories/session.repository";
import type { SessionOrigin } from "@/server/repositories/session.repository";
import * as users from "@/server/repositories/user.repository";
import { acceptInvite, findPendingInvite } from "@/server/services/team.service";
import { parseOrThrow } from "@/server/validate";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  profileSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  tokenSchema,
} from "@/validation/account";

/**
 * Accounts: password sign-in and sign-up, email verification, password reset, and the actor's own
 * profile, password, sessions and notification switches (spec §5.1–5.3, §5.5, §7).
 *
 * Every function that acts on an account takes the actor's id first and touches only that
 * account. The token flows (verify, reset, email change) are the exception by design: the token
 * itself — 32 random bytes, only its SHA-256 stored — is what proves the right to act.
 */

// --- Shared ------------------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const VERIFY_TTL_HOURS = 24;
const RESET_TTL_MINUTES = 60;
const EMAIL_CHANGE_TTL_HOURS = 24;

/** The one message for every failed password sign-in — it never says which half was wrong. */
export const SIGN_IN_FAILED = "That email and password don’t match.";
export const EMAIL_TAKEN = "That email is already used by another Routely account.";

function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function link(path: string): string {
  return appLink(env.NEXT_PUBLIC_APP_URL, path);
}

function send(to: string, rendered: Omit<EmailMessage, "to">): void {
  sendEmailAfter({ to, ...rendered });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function limitOrThrow(key: string, limit: number, windowMs: number, message: string): void {
  if (!rateLimit(key, limit, windowMs).allowed) throw rateLimited(message);
}

const TOO_MANY_SIGN_INS = "Too many sign-in attempts. Wait a few minutes and try again.";

// --- Sign-in -----------------------------------------------------------------------------------

/**
 * Checks an email and password. Returns the user id, or throws one generic `UNAUTHENTICATED` —
 * the same message, and the same work, whether the address is unknown, has no password (a
 * Google-only account), belongs to a disabled account, or the password is wrong.
 *
 * Rate-limited per (IP, email) — which stops guessing one account's password — and per IP, which
 * stops spraying one password across many accounts. Per-process, like every limiter here.
 */
export async function authenticatePassword(
  input: unknown,
  ip: string,
): Promise<{ userId: string }> {
  const { email, password } = parseOrThrow(signInSchema, input);

  limitOrThrow(`signin:${ip}:${email}`, 10, 15 * MINUTE, TOO_MANY_SIGN_INS);
  limitOrThrow(`signin-ip:${ip}`, 50, 15 * MINUTE, TOO_MANY_SIGN_INS);

  const user = await users.findUserForSignIn(email);
  const ok = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : await verifyAgainstDummy(password);

  if (!user || !ok || user.disabledAt) {
    throw new AppError("UNAUTHENTICATED", SIGN_IN_FAILED);
  }

  // Quietly upgrade a hash made with older cost parameters, now that the plaintext is in hand.
  if (user.passwordHash && needsRehash(user.passwordHash)) {
    const upgraded = await hashPassword(password);
    await db.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash },
      data: { passwordHash: upgraded },
    });
  }

  return { userId: user.id };
}

/**
 * Records the (browser, OS, country) a session came from and, when this account has signed in
 * before but never from that combination, sends "New sign-in to Routely". An account's very first
 * sign-in is recorded silently — there is no "usual" to compare it with yet.
 *
 * Used by both sign-in paths (password here, Google from `config.ts`). Never throws.
 */
export async function noteSignIn(userId: string, origin: SessionOrigin): Promise<void> {
  try {
    const ua = parseUserAgent(origin.userAgent);
    const fingerprint = hashToken(`${ua.browser}|${ua.os}|${origin.country ?? ""}`);
    const now = new Date();
    const hadAny = (await devices.countKnownDevices(userId)) > 0;
    const isNew = await devices.rememberDevice(userId, fingerprint, now);
    if (!hadAny || !isNew) return;

    const user = await users.findUserById(userId);
    if (!user) return;
    send(
      user.email,
      newSignInTemplate({
        name: user.name,
        device: ua.label,
        location: sessionWhere(origin.city, origin.country),
        at: now,
        sessionsUrl: link(routes.settings),
        supportEmail: env.SUPPORT_EMAIL,
      }),
    );
  } catch (error) {
    console.error("[routely] could not record the sign-in device", error);
  }
}

// --- Sign-up -----------------------------------------------------------------------------------

export interface SignUpResult {
  userId: string;
  /** Set when the account joined an invited workspace instead of getting its own. */
  joinedWorkspace: string | null;
}

/**
 * Creates a password account.
 *
 * Normally the account gets its own workspace ("{First}’s workspace", OWNER) and a verification
 * email. Signing up **through a valid invite addressed to this email** instead joins only the
 * inviting workspace — no orphan personal workspace — and needs no verification email, because
 * the invite link already proved the inbox (`acceptInvite` sets `emailVerified`). An invite for a
 * different address is ignored here; the account is created normally and `/invite/<token>` will
 * explain the mismatch.
 */
export async function signUp(
  input: unknown,
  invite: string | null,
  ip: string,
): Promise<SignUpResult> {
  const data = parseOrThrow(signUpSchema, input);
  limitOrThrow(`signup:${ip}`, 10, HOUR, "Too many sign-ups from this network. Try again later.");

  if (await users.emailTaken(data.email, null)) {
    throw validationFailed(EMAIL_TAKEN, { email: [EMAIL_TAKEN] });
  }

  const pending = invite ? await findPendingInvite(invite) : null;
  const viaInvite = pending && pending.email.toLowerCase() === data.email ? pending : null;
  const passwordHash = await hashPassword(data.password);
  const now = new Date();

  let result: SignUpResult;
  try {
    result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          passwordHash,
          passwordChangedAt: now,
        },
        select: { id: true, name: true, email: true },
      });
      if (viaInvite && invite) {
        const joined = await acceptInvite(user.id, invite, tx);
        return { userId: user.id, joinedWorkspace: joined.workspaceName };
      }
      await createPersonalWorkspace(tx, user);
      return { userId: user.id, joinedWorkspace: null };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw validationFailed(EMAIL_TAKEN, { email: [EMAIL_TAKEN] });
    throw error;
  }

  if (!result.joinedWorkspace) {
    await sendVerification(result.userId, data.name, data.email);
  }
  return result;
}

async function sendVerification(userId: string, name: string | null, email: string) {
  const { raw, hash } = newToken();
  await tokens.replaceVerificationToken(
    userId,
    hash,
    new Date(Date.now() + VERIFY_TTL_HOURS * HOUR),
  );
  send(
    email,
    verifyEmailTemplate({
      name,
      verifyUrl: link(routes.verifyEmail(raw)),
      expiresInHours: VERIFY_TTL_HOURS,
    }),
  );
}

/** `/verify-email/<token>`. Spends the token and marks the address verified. */
export async function verifyEmail(rawToken: string): Promise<"verified" | "invalid"> {
  const parsed = tokenSchema.safeParse(rawToken);
  if (!parsed.success) return "invalid";
  const userId = await tokens.consumeVerificationToken(hashToken(parsed.data), new Date());
  if (!userId) return "invalid";
  await users.markEmailVerified(userId, new Date());
  return "verified";
}

/**
 * Whether the user still has to confirm their address: a password account whose verification
 * link was never followed. A linked Google account proved the inbox at sign-in (the same rule as
 * team.service's inviter check and notification.service's recipients).
 */
export async function needsEmailVerification(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true, _count: { select: { accounts: true } } },
  });
  return !!user && !user.emailVerified && user._count.accounts === 0;
}

/** The app banner's "Resend link": a fresh link (the previous one stops working). 1 a minute, 5 a day. */
export async function resendVerification(actorUserId: string): Promise<{ email: string }> {
  const user = await users.findUserById(actorUserId);
  if (!user) throw notFound();
  if (!(await needsEmailVerification(actorUserId))) return { email: user.email };

  limitOrThrow(
    `verify-min:${actorUserId}`,
    1,
    MINUTE,
    "We just sent a link. Wait a minute before asking for another.",
  );
  limitOrThrow(
    `verify-day:${actorUserId}`,
    5,
    DAY,
    "You’ve asked for too many confirmation links today. Try again tomorrow.",
  );
  await sendVerification(user.id, user.name, user.email);
  return { email: user.email };
}

// --- Forgotten password ------------------------------------------------------------------------

/**
 * Emails a reset link when an account exists for the address. The caller always shows the same
 * confirmation, so this reveals nothing about which addresses have accounts. A Google-only
 * account gets a link too: following it is how such an account adds a password without Settings.
 */
export async function requestPasswordReset(input: unknown, ip: string): Promise<void> {
  const { email } = parseOrThrow(forgotPasswordSchema, input);
  limitOrThrow(`forgot:${ip}`, 20, HOUR, "Too many requests. Try again later.");
  // Per address, silently: a fourth link in 15 minutes is not sent, but the page says the same.
  if (!rateLimit(`forgot:${email}`, 3, 15 * MINUTE).allowed) return;

  const user = await users.findUserForSignIn(email);
  if (!user || user.disabledAt) return;

  const { raw, hash } = newToken();
  await tokens.createPasswordReset(
    user.id,
    hash,
    new Date(Date.now() + RESET_TTL_MINUTES * MINUTE),
  );
  send(
    user.email,
    resetPasswordTemplate({
      name: user.name,
      resetUrl: link(routes.resetPassword(raw)),
      expiresInMinutes: RESET_TTL_MINUTES,
    }),
  );
}

/** True when a reset link can still be used — for rendering the form, not consuming it. */
export async function isResetTokenUsable(rawToken: string): Promise<boolean> {
  const parsed = tokenSchema.safeParse(rawToken);
  if (!parsed.success) return false;
  return Boolean(await tokens.findUsablePasswordReset(hashToken(parsed.data), new Date()));
}

export const RESET_LINK_INVALID = "This reset link has expired or was already used.";

/**
 * Sets a new password from a reset link: one use, within the hour. Signs the account out
 * **everywhere** — the point of a reset is that someone else may have the old password — voids
 * every other outstanding reset link, marks the address verified (the link proved the inbox) and
 * sends "Your password was changed".
 */
export async function resetPassword(rawToken: string, input: unknown): Promise<void> {
  const data = parseOrThrow(resetPasswordSchema, input);
  const parsed = tokenSchema.safeParse(rawToken);
  if (!parsed.success) throw conflict(RESET_LINK_INVALID);

  const now = new Date();
  const found = await tokens.findUsablePasswordReset(hashToken(parsed.data), now);
  if (!found) throw conflict(RESET_LINK_INVALID);

  const passwordHash = await hashPassword(data.password);
  const user = await db.$transaction(async (tx) => {
    if (!(await tokens.consumePasswordReset(found.id, now, tx))) throw conflict(RESET_LINK_INVALID);
    await users.setPassword(found.userId, passwordHash, now, tx);
    await users.markEmailVerified(found.userId, now, tx);
    await tokens.invalidatePasswordResets(found.userId, now, tx);
    await sessions.deleteAllSessions(found.userId, tx);
    return users.findUserById(found.userId, tx);
  });

  if (user) {
    send(
      user.email,
      passwordChangedTemplate({
        name: user.name,
        changedAt: now,
        viaReset: true,
        supportEmail: env.SUPPORT_EMAIL,
      }),
    );
  }
}

// --- Settings: read model ----------------------------------------------------------------------

export async function getAccountSettings(
  actorUserId: string,
  currentSessionId: string | null,
  workspaceId: string,
): Promise<AccountSettings> {
  const now = new Date();
  const [user, membership, pending, sessionRows, prefRows] = await Promise.all([
    users.findUserById(actorUserId),
    users.findMembershipLabel(actorUserId, workspaceId),
    tokens.findPendingEmailChange(actorUserId, now),
    sessions.listActiveSessions(actorUserId, now),
    prefs.listPreferences(actorUserId),
  ]);
  if (!user) throw notFound();

  const stored = new Map(prefRows.map((row) => [row.kind as string, row.enabled]));

  const list = sessionRows.map((row) => {
    const ua = parseUserAgent(row.userAgent);
    const current = row.id === currentSessionId;
    return {
      id: row.id,
      device: ua.label,
      kind: ua.kind,
      where: sessionWhere(row.city, row.country),
      when: sessionWhen(row.lastSeenAt, now, current),
      current,
    };
  });
  // Current first, then most recently seen (the query's order).
  list.sort((a, b) => Number(b.current) - Number(a.current));

  return {
    name: user.name?.trim() || user.email,
    email: user.email,
    roleLabel: membership ? ROLE_LABEL[membership.role] : "Member",
    workspaceName: membership?.workspace.name ?? "",
    pendingEmail: pending?.newEmail ?? null,
    hasPassword: Boolean(user.passwordHash),
    passwordNote: passwordNote(Boolean(user.passwordHash), user.passwordChangedAt, now),
    sessions: list,
    notifications: NOTIFICATION_KINDS.map((kind) => ({
      id: kind,
      title: NOTIFICATION_SETTINGS[kind].title,
      desc: NOTIFICATION_SETTINGS[kind].description,
      on: stored.get(kind) ?? NOTIFICATION_SETTINGS[kind].defaultEnabled,
    })),
  };
}

// --- Settings: profile -------------------------------------------------------------------------

export type ProfileResult =
  { kind: "saved"; name: string } | { kind: "emailPending"; name: string; pendingEmail: string };

/**
 * Saves the name, and — when the email differs — starts an email change rather than changing the
 * address: `users.email` changes only when the link sent to the new address is followed
 * (`confirmEmailChange`). A later request supersedes an earlier one.
 */
export async function updateProfile(
  actorUserId: string,
  workspaceId: string,
  input: unknown,
): Promise<ProfileResult> {
  const data = parseOrThrow(profileSchema, input);
  const user = await users.findUserById(actorUserId);
  if (!user) throw notFound();

  const emailChanged = data.email !== user.email.toLowerCase();
  if (emailChanged) {
    const membership = await users.findMembershipLabel(actorUserId, workspaceId);
    if (await users.emailBelongsToMember(workspaceId, data.email, actorUserId)) {
      const message = `That email belongs to another member of ${membership?.workspace.name ?? "your workspace"}.`;
      throw validationFailed(message, { email: [message] });
    }
    if (await users.emailTaken(data.email, actorUserId)) {
      throw validationFailed(EMAIL_TAKEN, { email: [EMAIL_TAKEN] });
    }
    limitOrThrow(
      `email-change-day:${actorUserId}`,
      5,
      DAY,
      "You’ve asked for too many confirmation links today. Try again tomorrow.",
    );
  }

  if (data.name !== (user.name ?? "")) await users.updateName(actorUserId, data.name);
  if (!emailChanged) return { kind: "saved", name: data.name };

  const { raw, hash } = newToken();
  await db.$transaction((tx) =>
    tokens.replaceEmailChange(
      actorUserId,
      data.email,
      hash,
      new Date(Date.now() + EMAIL_CHANGE_TTL_HOURS * HOUR),
      tx,
    ),
  );
  sendEmailChangeLink(data.name, data.email, raw);
  return { kind: "emailPending", name: data.name, pendingEmail: data.email };
}

function sendEmailChangeLink(name: string | null, newEmail: string, raw: string) {
  send(
    newEmail,
    confirmEmailChangeTemplate({
      name,
      newEmail,
      confirmUrl: link(routes.confirmEmail(raw)),
      expiresInHours: EMAIL_CHANGE_TTL_HOURS,
    }),
  );
}

/** "Resend link": a fresh token (the previous link stops working). 1 a minute, 5 a day. */
export async function resendEmailChange(actorUserId: string): Promise<{ pendingEmail: string }> {
  const pending = await tokens.findPendingEmailChange(actorUserId, new Date());
  if (!pending) throw notFound("There’s no email change waiting to be confirmed.");

  limitOrThrow(
    `email-change-min:${actorUserId}`,
    1,
    MINUTE,
    "We just sent a link. Wait a minute before asking for another.",
  );
  limitOrThrow(
    `email-change-day:${actorUserId}`,
    5,
    DAY,
    "You’ve asked for too many confirmation links today. Try again tomorrow.",
  );

  const { raw, hash } = newToken();
  const rotated = await tokens.rotateEmailChange(
    actorUserId,
    pending.id,
    hash,
    new Date(Date.now() + EMAIL_CHANGE_TTL_HOURS * HOUR),
  );
  if (!rotated) throw notFound("There’s no email change waiting to be confirmed.");

  const user = await users.findUserById(actorUserId);
  sendEmailChangeLink(user?.name ?? null, pending.newEmail, raw);
  return { pendingEmail: pending.newEmail };
}

export async function cancelEmailChange(actorUserId: string): Promise<{ savedEmail: string }> {
  await tokens.cancelEmailChanges(actorUserId);
  const user = await users.findUserById(actorUserId);
  if (!user) throw notFound();
  return { savedEmail: user.email };
}

export type EmailConfirmResult = "changed" | "invalid" | "taken";

/**
 * `GET /settings/email/confirm?token=` — the token alone proves control of the new inbox, so no
 * session is required. Re-checks that no other account took the address meanwhile, switches
 * `users.email`, marks it verified, spends the token, and tells the **old** address — its owner
 * may not be the one who made the change. Google sign-in is unaffected: it is keyed by the Google
 * account id, not the email.
 */
export async function confirmEmailChange(rawToken: string): Promise<EmailConfirmResult> {
  const parsed = tokenSchema.safeParse(rawToken);
  if (!parsed.success) return "invalid";

  const now = new Date();
  const request = await tokens.findEmailChangeByToken(hashToken(parsed.data));
  if (!request || request.consumedAt || request.expiresAt <= now) return "invalid";

  const oldEmail = request.user.email;
  try {
    const outcome = await db.$transaction(async (tx) => {
      if (await users.emailTaken(request.newEmail, request.userId, tx)) return "taken" as const;
      if (!(await tokens.consumeEmailChange(request.id, now, tx))) return "invalid" as const;
      await tx.user.update({
        where: { id: request.userId },
        data: { email: request.newEmail, emailVerified: now },
      });
      return "changed" as const;
    });
    if (outcome !== "changed") return outcome;
  } catch (error) {
    if (isUniqueViolation(error)) return "taken";
    throw error;
  }

  send(
    oldEmail,
    emailChangedTemplate({
      name: request.user.name,
      oldEmail,
      newEmail: request.newEmail,
      supportEmail: env.SUPPORT_EMAIL,
    }),
  );
  return "changed";
}

// --- Settings: password ------------------------------------------------------------------------

export const WRONG_CURRENT_PASSWORD = "That’s not your current password";

/**
 * Changes the password (or, for a Google-only account, sets the first one). Other sessions stay
 * signed in — the design's choice, made safe by the sessions list and the security email; a
 * *reset* is what signs everything out.
 *
 * A wrong current password throws `UNAUTHENTICATED` with `WRONG_CURRENT_PASSWORD`, which the
 * screen shows as its banner. Attempts are rate-limited per account.
 */
export async function changePassword(
  actorUserId: string,
  input: Record<string, unknown>,
): Promise<{ passwordNote: string }> {
  const user = await users.findUserById(actorUserId);
  if (!user) throw notFound();
  const hasPassword = Boolean(user.passwordHash);

  const data = parseOrThrow(changePasswordSchema, { ...input, hasPassword });

  limitOrThrow(
    `pw-change:${actorUserId}`,
    10,
    15 * MINUTE,
    "Too many attempts. Wait a few minutes and try again.",
  );

  if (user.passwordHash && !(await verifyPassword(data.current, user.passwordHash))) {
    throw new AppError("UNAUTHENTICATED", WRONG_CURRENT_PASSWORD);
  }

  const now = new Date();
  const passwordHash = await hashPassword(data.next);
  if (!(await users.replacePassword(actorUserId, user.passwordHash, passwordHash, now))) {
    throw conflict("Your password changed while you were typing. Reload and try again.");
  }

  send(
    user.email,
    passwordChangedTemplate({
      name: user.name,
      changedAt: now,
      viaReset: false,
      supportEmail: env.SUPPORT_EMAIL,
    }),
  );
  return { passwordNote: passwordNote(true, now, now) };
}

// --- Settings: sessions ------------------------------------------------------------------------

/**
 * Signs out one of the actor's other sessions. Someone else's session id, or the current one,
 * matches nothing and reports NOT_FOUND — the filter is in the delete itself.
 */
export async function revokeSession(
  actorUserId: string,
  currentSessionId: string | null,
  sessionId: unknown,
): Promise<{ device: string }> {
  if (typeof sessionId !== "string" || !sessionId) throw notFound();
  const current = currentSessionId ?? "";
  const row = await sessions.findOtherSession(actorUserId, sessionId, current);
  if (!row) throw notFound("That session is no longer signed in.");
  const removed = await sessions.deleteOtherSession(actorUserId, sessionId, current);
  if (removed === 0) throw notFound("That session is no longer signed in.");
  return { device: parseUserAgent(row.userAgent).label };
}

export async function revokeOtherSessions(
  actorUserId: string,
  currentSessionId: string | null,
): Promise<{ count: number }> {
  return { count: await sessions.deleteOtherSessions(actorUserId, currentSessionId ?? "") };
}

// --- Settings: notifications -------------------------------------------------------------------

const preferenceSchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  enabled: z.boolean(),
});

export async function setNotificationPreference(
  actorUserId: string,
  kind: unknown,
  enabled: unknown,
): Promise<void> {
  const data = parseOrThrow(
    preferenceSchema,
    { kind, enabled },
    "Choose a notification to change.",
  );
  await prefs.setPreference(actorUserId, data.kind as NotificationKind, data.enabled);
}

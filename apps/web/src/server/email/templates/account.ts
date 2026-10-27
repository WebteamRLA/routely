import {
  type RenderedEmail,
  greeting,
  inlineText,
  renderEmail,
  subjectText,
} from "@/server/email/templates/layout";

/**
 * Account and security emails (spec §1.3). None of these can be opted out of: each one is either
 * a step the recipient asked for or the only way they would learn their account changed.
 *
 * Every link here carries a single-use token, so the copy says how long it lasts and what to do
 * if the recipient did not ask for it.
 */

/** Optional "contact support" line, when `SUPPORT_EMAIL` is configured. */
function supportLine(supportEmail: string | undefined): string[] {
  return supportEmail
    ? [`If you didn't make this change, contact ${inlineText(supportEmail)} right away.`]
    : ["If you didn't make this change, reset your password from the sign-in page right away."];
}

function formatWhen(at: Date): string {
  // UTC, stated, because the server does not know the recipient's timezone and an unlabelled
  // time that is hours off reads like a sign-in the recipient did not make.
  const date = at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${date}, ${time} UTC`;
}

// --- Verify your email -----------------------------------------------------------------------

export interface VerifyEmailInput {
  name: string | null;
  /** The six-digit code typed on `/verify-email`. */
  code: string;
  /** `/verify-email/<token>` — absolute. */
  verifyUrl: string;
  /** Lifetime of the code and the link, for the copy. */
  expiresInHours: number;
}

export function verifyEmailTemplate(input: VerifyEmailInput): RenderedEmail {
  return renderEmail(`${input.code} is your Routely verification code`, {
    preheader: "Enter this code, or use the link, to open your Routely account.",
    heading: "Verify your email",
    paragraphs: [
      greeting(input.name),
      "Enter this code on the verification page to open your Routely account:",
    ],
    code: input.code,
    action: { label: "Verify email and sign in", url: input.verifyUrl },
    notes: [
      `The code and the link expire in ${input.expiresInHours} hours.`,
      "If you didn't create a Routely account, you can ignore this email.",
    ],
  });
}

// --- Reset your password ---------------------------------------------------------------------

export interface ResetPasswordInput {
  name: string | null;
  /** `/reset-password/<token>` — absolute. */
  resetUrl: string;
  expiresInMinutes: number;
}

export function resetPasswordTemplate(input: ResetPasswordInput): RenderedEmail {
  return renderEmail("Reset your Routely password", {
    preheader: "Use this link to choose a new password.",
    heading: "Reset your password",
    paragraphs: [
      greeting(input.name),
      "Someone asked to reset the password for your Routely account. Choose a new one with the link below. Resetting it signs you out everywhere.",
    ],
    action: { label: "Choose a new password", url: input.resetUrl },
    notes: [
      `This link expires in ${input.expiresInMinutes} minutes and can be used once.`,
      "If you didn't ask for this, you can ignore this email. Your password won't change.",
    ],
  });
}

// --- Confirm your new email ------------------------------------------------------------------

export interface ConfirmEmailChangeInput {
  name: string | null;
  newEmail: string;
  /** `/settings/email/confirm?token=` — absolute. */
  confirmUrl: string;
  expiresInHours: number;
}

/** Sent to the **new** address; following the link is what proves the inbox belongs to them. */
export function confirmEmailChangeTemplate(input: ConfirmEmailChangeInput): RenderedEmail {
  return renderEmail("Confirm your new email for Routely", {
    preheader: "Confirm this address to start using it with Routely.",
    heading: "Confirm your new email",
    paragraphs: [
      greeting(input.name),
      [
        "You asked to change the email on your Routely account to ",
        { strong: inlineText(input.newEmail) },
        ". Confirm it with the link below. Until you do, Routely keeps using your current address.",
      ],
    ],
    action: { label: "Confirm email", url: input.confirmUrl },
    notes: [
      `This link expires in ${input.expiresInHours} hours.`,
      "If you didn't ask for this, you can ignore this email.",
    ],
  });
}

// --- Your email was changed ------------------------------------------------------------------

export interface EmailChangedInput {
  name: string | null;
  oldEmail: string;
  newEmail: string;
  supportEmail?: string;
}

/** Sent to the **old** address once the change is confirmed — its owner may not have made it. */
export function emailChangedTemplate(input: EmailChangedInput): RenderedEmail {
  return renderEmail("Your Routely email was changed", {
    preheader: "The email on your Routely account is now a different address.",
    heading: "Your email was changed",
    paragraphs: [
      greeting(input.name),
      [
        "The email on your Routely account was changed from ",
        { strong: inlineText(input.oldEmail) },
        " to ",
        { strong: inlineText(input.newEmail) },
        ". Routely will send everything to the new address from now on.",
      ],
    ],
    notes: supportLine(input.supportEmail),
  });
}

// --- Your password was changed ---------------------------------------------------------------

export interface PasswordChangedInput {
  name: string | null;
  changedAt: Date;
  /** True after a reset, which also signed every session out. */
  viaReset: boolean;
  supportEmail?: string;
}

export function passwordChangedTemplate(input: PasswordChangedInput): RenderedEmail {
  return renderEmail("Your Routely password was changed", {
    preheader: "The password on your Routely account was just changed.",
    heading: "Your password was changed",
    paragraphs: [
      greeting(input.name),
      `The password on your Routely account was changed on ${formatWhen(input.changedAt)}.`,
      input.viaReset
        ? "Because it was reset, every device was signed out."
        : "Your other sessions stayed signed in. You can sign them out from Settings.",
    ],
    notes: supportLine(input.supportEmail),
  });
}

// --- New sign-in -----------------------------------------------------------------------------

export interface NewSignInInput {
  name: string | null;
  /** "Chrome on macOS" — from the session's user agent. */
  device: string;
  /** "Portland, US", or null when the platform gave no location (local development). */
  location: string | null;
  at: Date;
  /** `/settings` — where the session can be signed out. Absolute. */
  sessionsUrl: string;
  supportEmail?: string;
}

export function newSignInTemplate(input: NewSignInInput): RenderedEmail {
  const where = input.location ? ` near ${inlineText(input.location)}` : "";
  return renderEmail("New sign-in to Routely", {
    preheader: `${inlineText(input.device)}${where}`,
    heading: "New sign-in to Routely",
    paragraphs: [
      greeting(input.name),
      [
        "Your Routely account was just signed in to from ",
        { strong: inlineText(input.device) },
        `${where} on ${formatWhen(input.at)}.`,
      ],
      "If this was you, there's nothing to do.",
    ],
    action: { label: "Review your sessions", url: input.sessionsUrl },
    notes: [
      input.supportEmail
        ? `If it wasn't you, sign that session out, change your password, and contact ${inlineText(input.supportEmail)}.`
        : "If it wasn't you, sign that session out and change your password.",
    ],
  });
}

// --- You're invited --------------------------------------------------------------------------

export interface InviteInput {
  inviterName: string | null;
  workspaceName: string;
  /** Display label, e.g. "Editor". */
  roleLabel: string;
  /** `/invite/<token>` — absolute. */
  inviteUrl: string;
  expiresInDays: number;
}

export function inviteTemplate(input: InviteInput): RenderedEmail {
  const workspace = inlineText(input.workspaceName) || "a workspace";
  const inviter = inlineText(input.inviterName ?? "") || "A teammate";
  const article = /^[aeiou]/i.test(input.roleLabel) ? "an" : "a";
  return renderEmail(`You're invited to ${subjectText(workspace)} on Routely`, {
    preheader: `${inviter} invited you to ${workspace}.`,
    heading: `Join ${workspace} on Routely`,
    paragraphs: [
      "Hi,",
      [
        { strong: inviter },
        " invited you to ",
        { strong: workspace },
        ` on Routely as ${article} ${inlineText(input.roleLabel)}. Routely runs A/B and split URL tests on your team's websites.`,
      ],
    ],
    action: { label: "Accept invite", url: input.inviteUrl },
    notes: [
      `This invite expires in ${input.expiresInDays} days.`,
      "If you weren't expecting it, you can ignore this email.",
    ],
  });
}

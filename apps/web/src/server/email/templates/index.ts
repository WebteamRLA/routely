/**
 * Every email Routely sends (spec §1.3), as pure `(input) => { subject, text, html }` functions.
 *
 * Seven account/security emails nobody can opt out of, and four notification emails governed by
 * `NotificationPreference`. Links are passed in as absolute URLs; see `layout.ts` for why.
 */

export type { RenderedEmail } from "@/server/email/templates/layout";
export { escapeHtml } from "@/server/email/templates/layout";

export {
  confirmEmailChangeTemplate,
  emailChangedTemplate,
  inviteTemplate,
  newSignInTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
  type ConfirmEmailChangeInput,
  type EmailChangedInput,
  type InviteInput,
  type NewSignInInput,
  type PasswordChangedInput,
  type ResetPasswordInput,
  type VerifyEmailInput,
} from "@/server/email/templates/account";

export {
  NOTIFICATION_PREFERENCES_PATH,
  appLink,
  experimentPausedTemplate,
  renderNotificationEmail,
  resultReadyTemplate,
  sheetsSyncFailedTemplate,
  trackingStoppedTemplate,
  type ExperimentPausedInput,
  type NotificationEnvelope,
  type NotificationKindKey,
  type NotificationPayloads,
  type ResultReadyInput,
  type SheetsSyncFailedInput,
  type TrackingStoppedInput,
} from "@/server/email/templates/notifications";

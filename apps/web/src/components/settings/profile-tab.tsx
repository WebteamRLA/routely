"use client";

import { AlertCircleIcon, Spinner, Svg } from "@/components/rt/icons";
import { ACCENT, ACCENT_LINE, ACCENT_WASH } from "@/components/rt/styles";
import {
  CardBody,
  CardFooter,
  Field,
  FooterStatus,
  SettingsCard,
  sbtn,
} from "@/components/settings/parts";
import { type AccountSession, initialsOf } from "@/lib/account";
import { cn } from "@/lib/utils";
import { changePasswordSchema, firstErrors, profileSchema } from "@/validation/account";

export interface ProfileState {
  savedName: string;
  savedEmail: string;
  name: string;
  email: string;
  attempted: boolean;
  busy: boolean;
  /** The address awaiting confirmation. */
  pending: string | null;
  /** A rejection only the server can make ("already used by another Routely account"). */
  serverError: string | null;
}

export interface PasswordState {
  cur: string;
  next: string;
  confirm: string;
  show: boolean;
  attempted: boolean;
  busy: boolean;
  /** "That’s not your current password". */
  serverErr: boolean;
  lastChanged: string;
}

export const EMPTY_PASSWORD: PasswordState = {
  cur: "",
  next: "",
  confirm: "",
  show: false,
  attempted: false,
  busy: false,
  serverErr: false,
  lastChanged: "",
};

/** The design's profile messages, plus "belongs to another member of {Workspace}". */
function profileErrors(
  p: Pick<ProfileState, "name" | "email">,
  otherMemberEmails: string[],
  workspaceName: string,
) {
  const found = firstErrors(profileSchema, { name: p.name, email: p.email });
  const e = { name: found["name"] ?? "", email: found["email"] ?? "" };
  if (!e.email && otherMemberEmails.includes(p.email.trim().toLowerCase())) {
    e.email = `That email belongs to another member of ${workspaceName}.`;
  }
  return e;
}

function passwordErrors(pw: Pick<PasswordState, "cur" | "next" | "confirm">, hasPassword: boolean) {
  const found = firstErrors(changePasswordSchema, {
    current: pw.cur,
    next: pw.next,
    confirm: pw.confirm,
    hasPassword,
  });
  return {
    cur: found["current"] ?? "",
    next: found["next"] ?? "",
    confirm: found["confirm"] ?? "",
  };
}

/**
 * Profile & security: the profile form, the password form and the signed-in sessions.
 *
 * A Google-only account (no password yet) sees the same password card without the current
 * password field, and "Set password" — not in the design, which assumes every account has one.
 */
export function ProfileTab({
  profile,
  pw,
  roleLabel,
  workspaceName,
  otherMemberEmails,
  hasPassword,
  sessions,
  sessBusy,
  onProfile,
  onResetProfile,
  onSaveProfile,
  onResendEmail,
  onCancelEmail,
  onPw,
  onSavePassword,
  onSignOutSession,
  onAskSignOut,
}: {
  profile: ProfileState;
  pw: PasswordState;
  roleLabel: string;
  workspaceName: string;
  otherMemberEmails: string[];
  hasPassword: boolean;
  sessions: AccountSession[];
  sessBusy: string | null;
  onProfile(patch: Partial<ProfileState>): void;
  onResetProfile(): void;
  onSaveProfile(hasErrors: boolean): void;
  onResendEmail(): void;
  onCancelEmail(): void;
  onPw(patch: Partial<PasswordState>): void;
  onSavePassword(hasErrors: boolean): void;
  onSignOutSession(s: AccountSession): void;
  onAskSignOut(): void;
}) {
  const pErr = profileErrors(profile, otherMemberEmails, workspaceName);
  const showP = (k: keyof typeof pErr) =>
    (profile.attempted ? pErr[k] : "") || (k === "email" ? (profile.serverError ?? "") : "");
  const dirty =
    profile.name.trim() !== profile.savedName ||
    profile.email.trim().toLowerCase() !== profile.savedEmail;
  const pStatus = profile.busy ? "Saving…" : dirty ? "Unsaved changes" : "";

  const wErr = passwordErrors(pw, hasPassword);
  const showW = (k: keyof typeof wErr) => (pw.attempted ? wErr[k] : "");
  const pwType = pw.show ? "text" : "password";
  const others = sessions.filter((d) => !d.current).length;

  return (
    <>
      <SettingsCard
        id="st-profile"
        title="Profile"
        description="How you appear to your team in Routely."
      >
        <CardBody>
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              aria-hidden
              className="inline-flex size-[52px] flex-[0_0_52px] items-center justify-center rounded-full bg-[#DBEAFE] text-[16px] font-semibold text-[#1E40AF]"
            >
              {initialsOf(profile.savedName)}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[15px] leading-[22px] font-semibold text-[#111827]">
                {profile.savedName}
              </span>
              <span className="text-[13px] leading-[19px] text-[#6B7280]">
                {roleLabel} of {workspaceName}
              </span>
            </div>
          </div>

          {profile.pending ? (
            <div
              role="status"
              className="flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3.5"
              style={{ borderColor: ACCENT_LINE, background: ACCENT_WASH }}
            >
              <Svg size={20} strokeWidth={1.8} stroke={ACCENT} className="mt-px flex-[0_0_20px]">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </Svg>
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-[#111827]">
                  Confirm your new email address
                </span>
                <span className="text-sm leading-5 text-pretty [overflow-wrap:anywhere] text-[#374151]">
                  We sent a link to {profile.pending}. Until you confirm it, Routely keeps using{" "}
                  {profile.savedEmail}.
                </span>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={onResendEmail}
                    className={cn(sbtn.text, "h-[30px] p-0")}
                    style={{ color: ACCENT }}
                  >
                    Resend link
                  </button>
                  <button
                    type="button"
                    onClick={onCancelEmail}
                    className={cn(sbtn.text, "h-[30px] p-0 text-[#4B5563]")}
                  >
                    Cancel change
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4 max-[641px]:grid-cols-[minmax(0,1fr)]">
            <Field
              id="st-name"
              label="Full name"
              type="text"
              value={profile.name}
              onChange={(e) => onProfile({ name: e.target.value })}
              disabled={profile.busy}
              placeholder="Your name"
              autoComplete="name"
              maxLength={100}
              error={showP("name")}
              hint="Shown to your team on experiments and activity."
            />
            <Field
              id="st-email"
              label="Email address"
              type="email"
              value={profile.email}
              onChange={(e) => onProfile({ email: e.target.value, serverError: null })}
              disabled={profile.busy}
              placeholder="name@company.com"
              autoComplete="email"
              maxLength={200}
              error={showP("email")}
              hint="Changing it sends a confirmation link to the new address."
            />
          </div>
        </CardBody>
        <CardFooter status={<FooterStatus busy={profile.busy} text={pStatus} />}>
          {dirty ? (
            <button
              type="button"
              onClick={onResetProfile}
              disabled={profile.busy}
              className={sbtn.secondary}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onSaveProfile(Boolean(pErr.name || pErr.email))}
            disabled={profile.busy || !dirty}
            className={sbtn.primary}
          >
            {profile.busy ? "Saving…" : "Save changes"}
          </button>
        </CardFooter>
      </SettingsCard>

      <SettingsCard id="st-pw" title="Password" description={pw.lastChanged}>
        <CardBody>
          {pw.serverErr ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5"
            >
              <AlertCircleIcon
                size={20}
                strokeWidth={1.8}
                className="mt-px flex-[0_0_20px] text-[#B91C1C]"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-[#B91C1C]">
                  That’s not your current password
                </span>
                <span className="text-sm leading-5 text-pretty text-[#B91C1C]">
                  Check it and try again. If you’ve forgotten it, sign out and use “Forgot password”
                  on the sign-in page.
                </span>
              </div>
            </div>
          ) : null}
          {hasPassword ? (
            <div className="max-w-[420px]">
              <Field
                id="st-pw-cur"
                label="Current password"
                type={pwType}
                value={pw.cur}
                onChange={(e) => onPw({ cur: e.target.value, serverErr: false })}
                disabled={pw.busy}
                autoComplete="current-password"
                maxLength={128}
                error={showW("cur")}
                hint="The password you use to sign in today."
              />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-4 max-[641px]:grid-cols-[minmax(0,1fr)]">
            <Field
              id="st-pw-new"
              label="New password"
              type={pwType}
              value={pw.next}
              onChange={(e) => onPw({ next: e.target.value })}
              disabled={pw.busy}
              autoComplete="new-password"
              maxLength={128}
              error={showW("next")}
              hint="At least 8 characters."
            />
            <Field
              id="st-pw-conf"
              label="Confirm new password"
              type={pwType}
              value={pw.confirm}
              onChange={(e) => onPw({ confirm: e.target.value })}
              disabled={pw.busy}
              autoComplete="new-password"
              maxLength={128}
              error={showW("confirm")}
              hint="Type the new password again."
            />
          </div>
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 text-[14px] text-[#374151]">
            <input
              type="checkbox"
              checked={pw.show}
              onChange={() => onPw({ show: !pw.show })}
              className="m-0 size-4 accent-[#0091FF]"
            />
            Show passwords
          </label>
        </CardBody>
        <CardFooter status={<FooterStatus busy={pw.busy} text={pw.busy ? "Updating…" : ""} />}>
          <button
            type="button"
            onClick={() => onSavePassword(Boolean(wErr.cur || wErr.next || wErr.confirm))}
            disabled={pw.busy}
            className={sbtn.primary}
          >
            {pw.busy ? "Updating…" : hasPassword ? "Update password" : "Set password"}
          </button>
        </CardFooter>
      </SettingsCard>

      <SettingsCard
        id="st-sess"
        title="Where you’re signed in"
        description="Sign out of any session you don’t recognize."
      >
        <CardBody>
          <ul className="m-0 list-none rounded-xl border border-[#EEF0F3] p-0">
            {sessions.map((d, i) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 px-3.5 py-3"
                style={{ borderTop: `1px solid ${i === 0 ? "transparent" : "#EEF0F3"}` }}
              >
                <span
                  aria-hidden
                  className="inline-flex size-[34px] flex-[0_0_34px] items-center justify-center rounded-lg bg-[#F3F4F6] text-[#4B5563]"
                >
                  {d.kind === "phone" ? (
                    <Svg size={17} strokeWidth={1.8}>
                      <rect x="7" y="2" width="10" height="20" rx="2" />
                      <path d="M11 18h2" />
                    </Svg>
                  ) : (
                    <Svg size={17} strokeWidth={1.8}>
                      <rect x="3" y="4" width="18" height="12" rx="2" />
                      <path d="M2 20h20" />
                    </Svg>
                  )}
                </span>
                <div className="flex min-w-0 flex-[1_1_200px] flex-col">
                  <span className="flex flex-wrap items-center gap-2 text-sm leading-5 font-semibold text-[#111827]">
                    {d.device}
                    {d.current ? (
                      <span className="inline-flex h-6 items-center rounded-md bg-[#DCFCE7] px-2 text-xs font-semibold text-[#166534]">
                        This device
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[13px] leading-[18px] text-[#6B7280]">
                    {d.where ? `${d.where} · ${d.when}` : d.when}
                  </span>
                </div>
                {!d.current ? (
                  <button
                    type="button"
                    onClick={() => onSignOutSession(d)}
                    disabled={sessBusy === d.id}
                    aria-label={`Sign out of ${d.device}`}
                    className={cn(sbtn.secondary, "h-[34px] gap-1.5 px-3")}
                  >
                    {sessBusy === d.id ? <Spinner /> : null}
                    Sign out
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
        <CardFooter
          status={
            <span className="flex-[1_1_240px] text-[13px] leading-[19px] text-[#6B7280]">
              You’ll stay signed in on this device.
            </span>
          }
        >
          <button
            type="button"
            onClick={onAskSignOut}
            disabled={others === 0}
            className={sbtn.dangerOutline}
          >
            Sign out of all other sessions
          </button>
        </CardFooter>
      </SettingsCard>
    </>
  );
}

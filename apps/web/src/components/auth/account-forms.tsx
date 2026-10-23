"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";

import {
  AuthAlert,
  AuthDivider,
  AuthField,
  AuthShell,
  AuthSubmit,
  AuthSwitch,
  authFocusRing,
} from "@/components/auth/auth-shell";
import { Spinner, Svg } from "@/components/rt/icons";
import { AFTER_SIGN_IN, routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  type AuthFormState,
  requestPasswordResetAction,
  resetPasswordAction,
  signUpAction,
} from "@/server/actions/account.actions";

/**
 * The account screens the design does not include (D12): sign-up, forgot password, reset
 * password. Each is a plain form posting a Server Action, so it works without JavaScript; the
 * server's messages are shown beside the fields they concern.
 */

const IDLE: AuthFormState = { status: "idle" };

function Banner({ state }: { state: AuthFormState }) {
  if (state.status === "error" && state.message) {
    return (
      <div className="py-2">
        <AuthAlert tone="error" title={state.message} />
      </div>
    );
  }
  return null;
}

/** The Login screen's Google button, without the design's popup states (a plain redirect here). */
function GoogleSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={cn(
        "flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[15px] font-medium text-[#111827] transition-[background,border-color] duration-[120ms]",
        "hover:enabled:border-[#C5C9D0] hover:enabled:bg-[#F9FAFB] disabled:cursor-progress",
        disabled && !pending && "disabled:cursor-not-allowed disabled:opacity-45",
        authFocusRing,
      )}
    >
      {pending ? (
        <Spinner size={20} className="flex-none text-[#0070C9]" />
      ) : (
        <span
          aria-hidden
          className="inline-flex size-5 flex-none items-center justify-center text-[#374151]"
        >
          <Svg size={18}>
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <path d="m10 17 5-5-5-5" />
            <path d="M15 12H3" />
          </Svg>
        </span>
      )}
      <span>{pending ? "Waiting for Google…" : "Continue with Google"}</span>
    </button>
  );
}

// --- Sign up -----------------------------------------------------------------------------------

export function SignUpView({
  googleAction,
  googleEnabled,
  invite,
  inviteNote,
  email,
  callbackUrl,
  supportEmail,
}: {
  googleAction(formData: FormData): Promise<void>;
  googleEnabled: boolean;
  invite: string | null;
  /** "Join Fernwood Group" context when arriving from a valid invite. */
  inviteNote: { title: string; body: string } | null;
  email: string;
  callbackUrl: string;
  supportEmail: string | null;
}) {
  const [state, formAction] = useActionState(signUpAction, IDLE);
  const fe = state.fieldErrors ?? {};
  const values = state.values ?? {};
  const loginHref =
    callbackUrl !== AFTER_SIGN_IN
      ? `${routes.login}?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : routes.login;

  return (
    <AuthShell
      title="Create your account"
      description="Run A/B and split URL tests on your websites, and see which version wins."
      supportEmail={supportEmail}
    >
      {inviteNote ? (
        <AuthAlert tone="info" title={inviteNote.title} body={inviteNote.body} />
      ) : null}

      <form action={googleAction} className="contents">
        <input
          type="hidden"
          name="callbackUrl"
          value={invite ? `/invite/${invite}` : callbackUrl}
        />
        <GoogleSubmit disabled={!googleEnabled} />
      </form>

      <AuthDivider />

      <form action={formAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        {invite ? <input type="hidden" name="invite" value={invite} /> : null}
        <Banner state={state} />
        <AuthField
          id="su-name"
          name="name"
          label="Full name"
          autoComplete="name"
          placeholder="Your name"
          maxLength={100}
          defaultValue={values["name"] ?? ""}
          key={`n:${values["name"] ?? ""}`}
          error={fe["name"]}
        />
        <AuthField
          id="su-email"
          name="email"
          type="email"
          label="Work email"
          autoComplete="email"
          placeholder="name@company.com"
          maxLength={254}
          defaultValue={values["email"] ?? email}
          key={`e:${values["email"] ?? email}`}
          error={fe["email"]}
        />
        <AuthField
          id="su-password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          maxLength={128}
          error={fe["password"]}
          hint="At least 8 characters."
        />
        <AuthSubmit label="Create account" pendingLabel="Creating your account…" />
      </form>

      <AuthSwitch prompt="Already have an account?" href={loginHref} label="Sign in" />
    </AuthShell>
  );
}

// --- Forgot password ---------------------------------------------------------------------------

export function ForgotPasswordView({ supportEmail }: { supportEmail: string | null }) {
  const [state, formAction] = useActionState(requestPasswordResetAction, IDLE);
  const fe = state.fieldErrors ?? {};

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email you sign in with and we’ll send you a link to choose a new password."
      supportEmail={supportEmail}
      footnote="none"
    >
      {state.status === "success" ? (
        <AuthAlert
          tone="success"
          title="Check your email"
          body={`${state.message} It expires in an hour.`}
        />
      ) : null}
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <Banner state={state} />
        <AuthField
          id="fp-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          placeholder="name@company.com"
          maxLength={254}
          defaultValue={state.values?.["email"] ?? ""}
          key={`e:${state.values?.["email"] ?? ""}:${state.status}`}
          error={fe["email"]}
        />
        <AuthSubmit
          label={state.status === "success" ? "Send another link" : "Send reset link"}
          pendingLabel="Sending…"
        />
      </form>
      <AuthSwitch prompt="Remembered it?" href={routes.login} label="Back to sign in" />
    </AuthShell>
  );
}

// --- Reset password ----------------------------------------------------------------------------

export function ResetPasswordView({
  token,
  usable,
  supportEmail,
}: {
  token: string;
  usable: boolean;
  supportEmail: string | null;
}) {
  const [state, formAction] = useActionState(resetPasswordAction, IDLE);
  const fe = state.fieldErrors ?? {};

  if (!usable) {
    return (
      <AuthShell
        title="This link has expired"
        description="Reset links work once, for an hour. Ask for a new one and use the latest email."
        supportEmail={supportEmail}
        footnote="none"
      >
        <Link
          href={routes.forgotPassword}
          className={cn(
            "flex h-12 w-full items-center justify-center rounded-lg bg-[#0070C9] px-4 text-[15px] font-semibold text-white no-underline hover:brightness-[.85]",
            authFocusRing,
          )}
        >
          Send a new link
        </Link>
        <AuthSwitch prompt="Remembered it?" href={routes.login} label="Back to sign in" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      description="You’ll be signed out everywhere else, then you can sign in with the new password."
      supportEmail={supportEmail}
      footnote="none"
    >
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <Banner state={state} />
        <AuthField
          id="rp-password"
          name="password"
          type="password"
          label="New password"
          autoComplete="new-password"
          maxLength={128}
          error={fe["password"]}
          hint="At least 8 characters."
        />
        <AuthField
          id="rp-confirm"
          name="confirm"
          type="password"
          label="Confirm new password"
          autoComplete="new-password"
          maxLength={128}
          error={fe["confirm"]}
          hint="Type the new password again."
        />
        <AuthSubmit label="Update password" pendingLabel="Updating…" />
      </form>
    </AuthShell>
  );
}

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";

import {
  AuthAlert,
  AuthDivider,
  AuthField,
  AuthShell,
  AuthSubmit,
  AuthSwitch,
  authTextLink,
} from "@/components/auth/auth-shell";
import { AlertCircleIcon, Spinner, Svg } from "@/components/rt/icons";
import { NOTE, type LoginMessage, type LoginPhase } from "@/lib/mock/login";
import { AFTER_SIGN_IN, routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { type AuthFormState, signInWithPasswordAction } from "@/server/actions/account.actions";

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";

/**
 * The sign-in screen.
 *
 * The Google button is the real thing: it submits `signInWithGoogle` (passed in as `action`),
 * and while that request is in flight the button shows the design's "Waiting for Google…" state.
 * The design's later steps (`signingIn`, `success`) happen on Google's side and Auth.js's
 * callback in the real flow, so they exist here only as `?view=` states for review.
 *
 * Below it, email + password sign-in (not in the design — D12): it creates the same database
 * session Google does (`server/auth/password-session.ts`).
 */
export function LoginView({
  action,
  callbackUrl,
  phase: initialPhase,
  notice,
  error: initialError,
  disabled,
  supportEmail,
}: {
  action(formData: FormData): Promise<void>;
  callbackUrl: string;
  phase: LoginPhase;
  notice: (LoginMessage & { tone?: "info" | "success" }) | null;
  error: LoginMessage | null;
  /** Google sign-in is not configured on this server. */
  disabled: boolean;
  supportEmail: string | null;
}) {
  const [phase, setPhase] = useState(initialPhase);
  const [error, setError] = useState(initialError);

  const cancel = () => {
    if (phase !== "waiting") return;
    setPhase("idle");
    setError({
      title: "Google sign-in didn’t finish",
      body: "The Google window was closed before you finished signing in. Nothing was changed, so you can try again when you’re ready.",
    });
  };

  const signupHref =
    callbackUrl && callbackUrl !== AFTER_SIGN_IN
      ? `${routes.signup}?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : routes.signup;

  return (
    <AuthShell
      title="Welcome"
      description="Sign in to manage your projects, experiments and results."
      supportEmail={supportEmail}
    >
      <form action={action} className="contents">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <SignInControls
          phase={phase}
          notice={notice}
          error={error}
          disabled={disabled}
          onCancel={cancel}
        />
      </form>

      {phase === "idle" ? (
        <>
          <AuthDivider />
          <PasswordSignIn callbackUrl={callbackUrl} />
          <AuthSwitch prompt="New to Routely?" href={signupHref} label="Create an account" />
        </>
      ) : null}
    </AuthShell>
  );
}

const IDLE: AuthFormState = { status: "idle" };

/** Email + password. A wrong email and a wrong password get the same message. */
function PasswordSignIn({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction] = useActionState(signInWithPasswordAction, IDLE);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {state.status === "error" && state.message ? (
        <div className="py-2">
          <AuthAlert tone="error" title={state.message} />
        </div>
      ) : null}
      <AuthField
        id="lg-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        placeholder="name@company.com"
        defaultValue={state.values?.["email"] ?? ""}
        key={`e:${state.values?.["email"] ?? ""}`}
        error={fe["email"]}
        maxLength={254}
      />
      <AuthField
        id="lg-password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        error={fe["password"]}
        maxLength={1024}
        aside={
          <Link
            href={routes.forgotPassword}
            className={cn(authTextLink, "text-[13px] font-medium")}
          >
            Forgot password?
          </Link>
        }
      />
      <AuthSubmit label="Sign in" pendingLabel="Signing in…" />
    </form>
  );
}

/**
 * Everything that reacts to the form being submitted. A child of the `<form>` because
 * `useFormStatus` only reports on its enclosing form.
 */
function SignInControls({
  phase: mockPhase,
  notice,
  error,
  disabled,
  onCancel,
}: {
  phase: LoginPhase;
  notice: (LoginMessage & { tone?: "info" | "success" }) | null;
  error: LoginMessage | null;
  disabled: boolean;
  onCancel(): void;
}) {
  const { pending } = useFormStatus();
  // A real submission is in the design's "waiting" step — but the request cannot be cancelled
  // once sent, and no separate Google window opens, so it shows neither the note nor Cancel.
  const phase: LoginPhase = pending ? "waiting" : mockPhase;
  const busy = phase !== "idle";
  const note = pending ? "" : NOTE[phase];
  const label =
    phase === "waiting"
      ? "Waiting for Google…"
      : phase === "idle"
        ? "Continue with Google"
        : "Signing you in…";

  return (
    <>
      {notice && !error && phase === "idle" ? (
        <AuthAlert tone={notice.tone ?? "info"} title={notice.title} body={notice.body} />
      ) : null}

      {error && !busy ? (
        <div
          role="alert"
          className="-my-2 flex items-start gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5"
        >
          <AlertCircleIcon size={20} strokeWidth={1.8} className="mt-px flex-none text-[#B91C1C]" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm leading-5 font-semibold text-[#B91C1C]">{error.title}</span>
            <span className="text-sm leading-5 text-pretty [overflow-wrap:anywhere] text-[#B91C1C]">
              {error.body}
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={busy || disabled}
          aria-busy={busy}
          className={cn(
            "flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[15px] font-medium text-[#111827] transition-[background,border-color] duration-[120ms]",
            "hover:enabled:border-[#C5C9D0] hover:enabled:bg-[#F9FAFB] disabled:cursor-progress",
            disabled && !busy && "disabled:cursor-not-allowed disabled:opacity-45",
            focusRing,
          )}
        >
          {busy ? (
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
          <span>{label}</span>
        </button>
        {note ? (
          <p
            aria-live="polite"
            className="m-0 text-center text-[13px] leading-5 text-pretty text-[#6B7280]"
          >
            {note}
          </p>
        ) : null}
        {phase === "waiting" && !pending ? (
          <div className="-mt-1 flex justify-center">
            <button
              type="button"
              onClick={onCancel}
              className={cn(
                "h-9 cursor-pointer border-0 bg-transparent px-2 text-[13px] font-medium text-[#4B5563] hover:text-[#111827]",
                focusRing,
              )}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

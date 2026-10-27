"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useFormStatus } from "react-dom";

import {
  AlertCircleIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  Spinner,
  Svg,
} from "@/components/rt/icons";
import { ToastHost, useToast } from "@/components/rt/toast";
import { input } from "@/components/rt/styles";
import { authFocusRing, authTextLink } from "@/components/auth/styles";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The sign-in screen's frame, shared by every account screen the design does not include —
 * sign-up, forgot and reset password, verify email (D12). They are built in the Login screen's
 * visual language: the same centred 400px column on white, brand lock-up, 26px heading, alert
 * boxes and footer, so an undesigned step reads as part of the same flow.
 */

// Plain strings, kept in a module without "use client" so server pages (the legal pages) can use
// them too; re-exported here for the account screens that already import them from this file.
export { authFocusRing, authTextLink } from "@/components/auth/styles";

export function AuthShell({
  title,
  description,
  supportEmail,
  footnote = "legal",
  children,
}: {
  title: string;
  description: ReactNode;
  /** `SUPPORT_EMAIL`, when configured — "Contact support" becomes a mailto link. */
  supportEmail?: string | null;
  /** The legal line under the form, or nothing (pages that are not a step towards signing in). */
  footnote?: "legal" | "none";
  children: ReactNode;
}) {
  const { toast, notify } = useToast();

  return (
    <div className="min-h-screen bg-white text-sm leading-[1.45] text-[#111827] antialiased selection:bg-[#D6ECFF]">
      <main className="flex min-h-screen flex-col bg-white">
        <div className="flex flex-auto items-center justify-center px-6 py-12 max-[641px]:items-start max-[641px]:px-4 max-[641px]:pt-14 max-[641px]:pb-8">
          <section
            aria-labelledby="rt-lg-title"
            className="flex w-full max-w-[400px] flex-col gap-8 max-[641px]:gap-7"
          >
            <div role="img" aria-label="Routely">
              <div className="inline-flex h-[52px] items-center gap-3 text-[#111827]">
                <Image
                  src="/routely-mark.png"
                  alt=""
                  width={46}
                  height={52}
                  loading="eager"
                  unoptimized
                  className="block h-[52px] w-[46px] flex-none"
                />
                <span className="text-[30px] leading-9 font-semibold tracking-[-0.01em]">
                  Routely
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h1
                id="rt-lg-title"
                className="m-0 text-[26px] leading-[34px] font-semibold tracking-[-0.02em] text-[#111827] max-[641px]:text-2xl max-[641px]:leading-8"
              >
                {title}
              </h1>
              <p className="m-0 text-[15px] leading-[22px] text-pretty text-[#4B5563]">
                {description}
              </p>
            </div>

            {children}

            {footnote === "legal" ? (
              <p className="m-0 text-xs leading-[18px] text-pretty text-[#6B7280]">
                By continuing, you agree to Routely’s{" "}
                <Link href={routes.termsOfService} className={authTextLink}>
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href={routes.privacyPolicy} className={authTextLink}>
                  Privacy Policy
                </Link>
                .
              </p>
            ) : null}
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-6 py-5 text-[13px] leading-[18px] text-[#6B7280] max-[641px]:flex-col">
          <span>© 2026 Routely</span>
          <span aria-hidden className="max-[641px]:hidden">
            ·
          </span>
          <span>
            Trouble signing in?{" "}
            {supportEmail ? (
              <a href={`mailto:${supportEmail}`} className={authTextLink}>
                Contact support
              </a>
            ) : (
              <button
                type="button"
                className={authTextLink}
                onClick={() =>
                  notify("Contact support", "Support isn’t set up on this server yet.")
                }
              >
                Contact support
              </button>
            )}
          </span>
        </div>
      </main>

      <ToastHost toast={toast} />
    </div>
  );
}

/** The Login screen's notice (blue, padlock), error (red) and a success (green) variant. */
export function AuthAlert({
  tone,
  title,
  body,
}: {
  tone: "info" | "error" | "success";
  title: string;
  body?: ReactNode;
}) {
  if (tone === "error") {
    return (
      <div
        role="alert"
        className="-my-2 flex items-start gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5"
      >
        <AlertCircleIcon size={20} strokeWidth={1.8} className="mt-px flex-none text-[#B91C1C]" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm leading-5 font-semibold text-[#B91C1C]">{title}</span>
          {body ? (
            <span className="text-sm leading-5 text-pretty [overflow-wrap:anywhere] text-[#B91C1C]">
              {body}
            </span>
          ) : null}
        </div>
      </div>
    );
  }
  const success = tone === "success";
  return (
    <div
      role="status"
      className={cn(
        "-my-2 flex items-start gap-3 rounded-xl border px-4 py-3.5",
        success ? "border-[#BBF7D0] bg-[#F0FDF4]" : "border-[#CCE7FF] bg-[#F0F7FF]",
      )}
    >
      <span
        aria-hidden
        className={cn("mt-px inline-flex flex-none", success ? "text-[#15803D]" : "text-[#0070C9]")}
      >
        {success ? (
          <CheckIcon size={20} strokeWidth={2} />
        ) : (
          <Svg size={20}>
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </Svg>
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm leading-5 font-semibold text-[#111827]">{title}</span>
        {body ? (
          <span className="text-sm leading-5 text-pretty [overflow-wrap:anywhere] text-[#374151]">
            {body}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Label, 44px input, and the error (or hint) beneath it. A password field gets an eye button
 * that shows or hides what was typed.
 */
export function AuthField({
  id,
  label,
  error,
  hint,
  aside,
  className,
  type,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  /** Right of the label, e.g. "Forgot password?". */
  aside?: ReactNode;
}) {
  const helpId = `${id}-help`;
  const help = error || hint;
  const isPassword = type === "password";
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-[#374151]">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          type={isPassword && visible ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={help ? helpId : undefined}
          {...props}
          className={cn(input, "h-11 text-[15px]", isPassword && "pr-11", className)}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            aria-controls={id}
            className={cn(
              "absolute top-1/2 right-1.5 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-[#6B7280] hover:text-[#111827]",
              authFocusRing,
            )}
          >
            {visible ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
          </button>
        ) : null}
      </div>
      {help ? (
        <p
          id={helpId}
          role={error ? "alert" : undefined}
          className={cn(
            "m-0 text-[13px] leading-[19px]",
            error ? "text-[#B91C1C]" : "text-[#6B7280]",
          )}
        >
          {help}
        </p>
      ) : null}
    </div>
  );
}

/** The full-width primary submit; shows a spinner while its form is in flight. */
export function AuthSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg border-0 bg-[#0070C9] px-4 text-[15px] font-semibold text-white transition-[filter] duration-[120ms] hover:enabled:brightness-[.85] disabled:cursor-progress disabled:opacity-80",
        authFocusRing,
      )}
    >
      {pending ? <Spinner size={18} className="flex-none text-white" /> : null}
      {pending ? pendingLabel : label}
    </button>
  );
}

/** "or" between the Google button and the email form. */
export function AuthDivider() {
  return (
    <div className="-my-2 flex items-center gap-3 text-[13px] text-[#6B7280]" aria-hidden>
      <span className="h-px flex-auto bg-[#E5E7EB]" />
      or
      <span className="h-px flex-auto bg-[#E5E7EB]" />
    </div>
  );
}

/** A line of text with one link, e.g. "New to Routely? Create an account". */
export function AuthSwitch({
  prompt,
  href,
  label,
}: {
  prompt: string;
  href: string;
  label: string;
}) {
  return (
    <p className="m-0 -mt-2 text-center text-sm leading-5 text-[#4B5563]">
      {prompt}{" "}
      <Link href={href} className={authTextLink}>
        {label}
      </Link>
    </p>
  );
}

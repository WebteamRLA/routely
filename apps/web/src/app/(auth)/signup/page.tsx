import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignUpView } from "@/components/auth/account-forms";
import { env } from "@/env";
import { AFTER_SIGN_IN } from "@/lib/routes";
import { signInWithGoogle } from "@/server/auth/actions";
import { getSession, isAuthConfigured } from "@/server/auth/session";
import { findPendingInvite } from "@/server/services/team.service";
import { isValidEmail } from "@/validation/account";

export const metadata: Metadata = { title: "Create your account" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeCallbackUrl(value: string | undefined): string {
  if (!value) return AFTER_SIGN_IN;
  return value.startsWith("/") && !value.startsWith("//") ? value : AFTER_SIGN_IN;
}

/**
 * Email + password sign-up (not in the design — D12). `?invite=<token>&email=` arrives from
 * `/invite/<token>`: a valid invite for that address joins the inviting workspace instead of
 * creating a personal one.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  const callbackUrl = safeCallbackUrl(first(params["callbackUrl"]));
  if (session) redirect(callbackUrl);

  const invite = first(params["invite"])?.trim() || null;
  const pending = invite ? await findPendingInvite(invite) : null;
  const emailParam = first(params["email"])?.trim().toLowerCase() ?? "";
  // Prefill only from the invite itself or a well-formed address; never echo arbitrary text.
  const email = pending?.email ?? (isValidEmail(emailParam) ? emailParam.slice(0, 254) : "");

  return (
    <SignUpView
      googleAction={signInWithGoogle}
      googleEnabled={isAuthConfigured()}
      invite={pending ? invite : null}
      inviteNote={
        pending
          ? {
              title: `Join ${pending.workspaceName}`,
              body: `Create your account with ${pending.email} to accept the invite.`,
            }
          : null
      }
      email={email}
      callbackUrl={callbackUrl}
      supportEmail={env.SUPPORT_EMAIL ?? null}
    />
  );
}

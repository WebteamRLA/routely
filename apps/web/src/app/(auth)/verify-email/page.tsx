import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VerifyCodeView } from "@/components/auth/account-forms";
import { env } from "@/env";
import { AFTER_SIGN_IN, routes } from "@/lib/routes";
import { verifyingUserId } from "@/server/auth/verify-cookie";
import { verificationStatus } from "@/server/services/account.service";

export const metadata: Metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
};

function safeCallbackUrl(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith("/") && !v.startsWith("//") ? v : AFTER_SIGN_IN;
}

/**
 * Where sign-up (and a password sign-in to an unverified account) lands: type the code from
 * "Verify your email" to open the account. The account comes from this browser's pending cookie
 * or, for an older account, its session — never from the URL.
 */
export default async function VerifyCodePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [userId, params] = await Promise.all([verifyingUserId(), searchParams]);
  const callbackUrl = safeCallbackUrl(params["callbackUrl"]);
  const status = userId ? await verificationStatus(userId) : null;
  if (!status) redirect(routes.login);
  if (status.verified) redirect(callbackUrl);

  return (
    <VerifyCodeView
      email={status.email}
      codeLive={status.codeLive}
      callbackUrl={callbackUrl}
      supportEmail={env.SUPPORT_EMAIL ?? null}
    />
  );
}

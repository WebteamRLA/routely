import type { Metadata } from "next";

import { VerifyLinkView } from "@/components/auth/account-forms";
import { AuthMessage } from "@/components/auth/auth-message";
import { env } from "@/env";
import { AFTER_SIGN_IN, routes } from "@/lib/routes";
import { getSession } from "@/server/auth/session";
import { peekVerificationLink } from "@/server/services/account.service";

export const metadata: Metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The link in "Verify your email". Arriving only checks it; the button spends it, verifies the
 * address and signs the account in (`verifyLinkAction`) — so a mail scanner's prefetch cannot use
 * it up. A used or expired link explains itself and points onward.
 */
export default async function VerifyEmailLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [userId, session] = await Promise.all([peekVerificationLink(token), getSession()]);
  const supportEmail = env.SUPPORT_EMAIL ?? null;

  if (userId) return <VerifyLinkView token={token} supportEmail={supportEmail} />;

  return (
    <AuthMessage
      title="This link has expired or was already used"
      description="Verification links work once, for 24 hours. If your email is already verified, sign in; otherwise sign in to get a new code."
      action={
        session
          ? { href: AFTER_SIGN_IN, label: "Go to your dashboard" }
          : { href: routes.login, label: "Sign in" }
      }
      supportEmail={supportEmail}
    />
  );
}

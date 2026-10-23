import type { Metadata } from "next";

import { AuthMessage } from "@/components/auth/auth-message";
import { env } from "@/env";
import { AFTER_SIGN_IN } from "@/lib/routes";
import { getSession } from "@/server/auth/session";
import { verifyEmail } from "@/server/services/account.service";

export const metadata: Metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The link in "Verify your email". Following it is the whole action, so the token is spent on
 * arrival; a second visit (or a mail scanner's prefetch first) reports the link as used, and the
 * address stays verified either way.
 */
export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [outcome, session] = await Promise.all([verifyEmail(token), getSession()]);
  const next = session
    ? { href: AFTER_SIGN_IN, label: "Go to your dashboard" }
    : { href: "/login", label: "Sign in" };

  return outcome === "verified" ? (
    <AuthMessage
      title="Your email is verified"
      description="Thanks — your Routely account is all set. You can now invite teammates."
      action={next}
      supportEmail={env.SUPPORT_EMAIL ?? null}
    />
  ) : (
    <AuthMessage
      title="This link has expired or was already used"
      description="Verification links work once, for 24 hours. If your email is already verified, there’s nothing more to do."
      action={next}
      supportEmail={env.SUPPORT_EMAIL ?? null}
    />
  );
}

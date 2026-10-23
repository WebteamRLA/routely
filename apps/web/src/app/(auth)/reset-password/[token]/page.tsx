import type { Metadata } from "next";

import { ResetPasswordView } from "@/components/auth/account-forms";
import { env } from "@/env";
import { isResetTokenUsable } from "@/server/services/account.service";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The URL is a bearer token: keep it out of indexes and other sites' referrer logs.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The link in "Reset your password". Showing the form does not spend the token — a mail scanner
 * prefetching the link must not burn it — only submitting the new password does.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const usable = await isResetTokenUsable(token);
  return (
    <ResetPasswordView
      token={usable ? token : ""}
      usable={usable}
      supportEmail={env.SUPPORT_EMAIL ?? null}
    />
  );
}

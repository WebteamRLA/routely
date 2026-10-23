import type { Metadata } from "next";

import { ForgotPasswordView } from "@/components/auth/account-forms";
import { env } from "@/env";

export const metadata: Metadata = { title: "Reset your password" };

/**
 * Asks for a reset link. The page always answers the same way, whether or not an account exists
 * for the address, so it cannot be used to discover who has one.
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordView supportEmail={env.SUPPORT_EMAIL ?? null} />;
}

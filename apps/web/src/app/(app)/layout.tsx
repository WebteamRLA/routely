import { AppShell } from "@/components/layout/app-shell";
import { requireSession } from "@/server/auth/session";
import { needsEmailVerification } from "@/server/services/account.service";

/**
 * The authorization boundary for the entire dashboard.
 *
 * Gating happens here — in a Server Component that runs before any child renders — rather
 * than in `proxy.ts`, because proxy runs on cached and prefetched requests too and the
 * Next.js docs explicitly warn against treating it as a session-management layer. Pages that
 * load user data still call `requireUser()` in their service calls, so authorization is
 * enforced at the data layer as well and never depends on the layout alone.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const verifyEmail = await needsEmailVerification(session.user.id);

  return (
    <AppShell user={session.user} verifyEmail={verifyEmail}>
      {children}
    </AppShell>
  );
}

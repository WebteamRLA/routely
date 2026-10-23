import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AlertCircleIcon, Svg } from "@/components/rt/icons";
import { AFTER_SIGN_IN, routes } from "@/lib/routes";
import { invitePath, withArticle } from "@/lib/team";
import { cn } from "@/lib/utils";
import {
  acceptInviteAction,
  continueInviteWithGoogle,
  signOutForInvite,
} from "@/server/actions/team.actions";
import { getSession, isAuthConfigured } from "@/server/auth/session";
import { type InviteLookup, lookupInvite } from "@/server/services/team.service";

import { InviteSubmitButton } from "./submit-button";

export const metadata: Metadata = {
  title: "Join a workspace",
  robots: { index: false, follow: false },
};

const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";
const txtLink = cn(
  "font-semibold text-[#374151] underline decoration-[#D1D5DB] underline-offset-2 hover:text-[#111827] hover:decoration-[#111827]",
  focusRing,
);

/**
 * Accepting a team invite (`/invite/<token>`) — not in the design, so built in the Login screen's
 * visual style (decision D12).
 *
 * Public: the token in the URL is the credential, and it is looked up by hash. What the page offers
 * depends on who is looking:
 * - signed in as the invited address → "Accept invite";
 * - signed in as someone else → "This invite was sent to {email}", with a way to switch accounts;
 * - signed out → Google (the adapter joins a *new* Google account to this workspace instead of
 *   creating a personal one), create an account with a password, or sign in and come back.
 * Used, revoked, expired and unknown links each explain themselves.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ failed?: string }>;
}) {
  const [{ token }, { failed }, session] = await Promise.all([params, searchParams, getSession()]);
  const invite = await lookupInvite(token);
  const user = session?.user ?? null;

  // A reload (or the Google round trip for a brand-new account) after accepting lands in the app.
  if (invite?.status === "accepted" && user && invite.acceptedById === user.id) {
    redirect(AFTER_SIGN_IN);
  }

  if (!invite) {
    return (
      <InviteShell title="This invite link isn’t valid">
        <Alert
          title="We couldn’t find this invite"
          body="Check that you opened the whole link from the email, or ask your workspace admin to send a new invite."
        />
        <BackLink signedIn={!!user} />
      </InviteShell>
    );
  }

  const inviter = invite.inviterName ?? "Your workspace admin";
  const unusable = unusableCopy(invite, inviter);
  if (unusable) {
    return (
      <InviteShell title={unusable.title} intro={intro(invite, inviter)}>
        <Alert title={unusable.title} body={unusable.body} />
        <BackLink signedIn={!!user} />
      </InviteShell>
    );
  }

  const returnTo = invitePath(token);

  if (user && user.email.toLowerCase() !== invite.email) {
    return (
      <InviteShell title={`Join ${invite.workspaceName}`} intro={intro(invite, inviter)}>
        <Alert
          title={`This invite was sent to ${invite.email}`}
          body={`You’re signed in as ${user.email}. Sign out, then sign in or create an account with ${invite.email} to accept it.`}
        />
        <form action={signOutForInvite} className="contents">
          <input type="hidden" name="token" value={token} />
          <InviteSubmitButton
            variant="outline"
            label="Sign out and switch account"
            pendingLabel="Signing out…"
            icon={<SignInGlyph />}
          />
        </form>
      </InviteShell>
    );
  }

  if (user) {
    return (
      <InviteShell title={`Join ${invite.workspaceName}`} intro={intro(invite, inviter)}>
        {failed ? (
          <Alert
            title="We couldn’t accept this invite"
            body="Something changed while you were accepting it. Try again, or ask for a new invite."
          />
        ) : null}
        <form action={acceptInviteAction} className="contents">
          <input type="hidden" name="token" value={token} />
          <InviteSubmitButton variant="primary" label="Accept invite" pendingLabel="Joining…" />
        </form>
        <p className="m-0 text-xs leading-[18px] text-pretty text-[#6B7280]">
          You’re signed in as {user.email}. Your own workspace stays as it is; you can switch
          between workspaces from the account menu.
        </p>
      </InviteShell>
    );
  }

  const googleReady = isAuthConfigured();
  const signupHref = `/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}`;
  const loginHref = `${routes.login}?callbackUrl=${encodeURIComponent(returnTo)}`;

  return (
    <InviteShell title={`Join ${invite.workspaceName}`} intro={intro(invite, inviter)}>
      <div className="flex flex-col gap-3">
        {googleReady ? (
          <form action={continueInviteWithGoogle} className="contents">
            <input type="hidden" name="token" value={token} />
            <InviteSubmitButton
              variant="outline"
              label="Continue with Google"
              pendingLabel="Waiting for Google…"
              icon={<SignInGlyph />}
            />
          </form>
        ) : null}
        <Link
          href={signupHref}
          className={cn(
            "flex h-12 w-full items-center justify-center rounded-lg border-0 bg-[#0070C9] px-4 text-[15px] font-semibold text-white no-underline shadow-[0_1px_2px_#11182714] hover:brightness-[.8]",
            focusRing,
          )}
        >
          Create an account with {invite.email}
        </Link>
      </div>
      <p className="m-0 text-[13px] leading-5 text-pretty text-[#4B5563]">
        Already have a Routely account?{" "}
        <Link href={loginHref} className={txtLink}>
          Sign in
        </Link>{" "}
        with {invite.email} and you’ll come back here to accept.
      </p>
    </InviteShell>
  );
}

function intro(invite: InviteLookup, inviter: string): string {
  return `${inviter} invited ${invite.email} to join ${invite.workspaceName} on Routely as ${withArticle(invite.role)}.`;
}

function unusableCopy(
  invite: InviteLookup,
  inviter: string,
): { title: string; body: string } | null {
  switch (invite.status) {
    case "accepted":
      return {
        title: "This invite has already been used",
        body: `If it was you, sign in with ${invite.email} to open ${invite.workspaceName}.`,
      };
    case "revoked":
      return {
        title: "This invite was revoked",
        body: `${inviter} cancelled it. Ask them to send a new one if you still need access.`,
      };
    case "expired":
      return {
        title: "This invite has expired",
        body: `Invites expire after 7 days. Ask ${inviter} to send you a new one.`,
      };
    default:
      return null;
  }
}

function SignInGlyph() {
  return (
    <Svg size={18} className="text-[#374151]">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="m10 17 5-5-5-5" />
      <path d="M15 12H3" />
    </Svg>
  );
}

function BackLink({ signedIn }: { signedIn: boolean }) {
  return (
    <p className="m-0 text-[13px] leading-5 text-[#4B5563]">
      <Link href={signedIn ? AFTER_SIGN_IN : routes.login} className={txtLink}>
        {signedIn ? "Go to your dashboard" : "Go to sign in"}
      </Link>
    </p>
  );
}

function Alert({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="alert"
      className="-my-2 flex items-start gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5"
    >
      <AlertCircleIcon size={20} strokeWidth={1.8} className="mt-px flex-none text-[#B91C1C]" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm leading-5 font-semibold [overflow-wrap:anywhere] text-[#B91C1C]">
          {title}
        </span>
        <span className="text-sm leading-5 text-pretty [overflow-wrap:anywhere] text-[#B91C1C]">
          {body}
        </span>
      </div>
    </div>
  );
}

/** The Login screen's frame: logo, heading, intro, then the page's own content, and its footer. */
function InviteShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-sm leading-[1.45] text-[#111827] antialiased selection:bg-[#D6ECFF]">
      <main className="flex min-h-screen flex-col bg-white">
        <div className="flex flex-auto items-center justify-center px-6 py-12 max-[641px]:items-start max-[641px]:px-4 max-[641px]:pt-14 max-[641px]:pb-8">
          <section
            aria-labelledby="rt-inv-title"
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
                id="rt-inv-title"
                className="m-0 text-[26px] leading-[34px] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] text-[#111827] max-[641px]:text-2xl max-[641px]:leading-8"
              >
                {title}
              </h1>
              {intro ? (
                <p className="m-0 text-[15px] leading-[22px] text-pretty [overflow-wrap:anywhere] text-[#4B5563]">
                  {intro}
                </p>
              ) : null}
            </div>

            {children}
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-6 py-5 text-[13px] leading-[18px] text-[#6B7280]">
          <span>© 2026 Routely</span>
        </div>
      </main>
    </div>
  );
}

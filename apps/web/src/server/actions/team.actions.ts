"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

import { AFTER_SIGN_IN, routes } from "@/lib/routes";
import { invitePath, roleLabel } from "@/lib/team";
import { signIn, signOut } from "@/server/auth";
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE_S } from "@/server/auth/invite-cookie";
import { requireUser } from "@/server/auth/session";
import { toPublicError } from "@/server/errors";
import * as teamService from "@/server/services/team.service";

/**
 * Server Actions for Settings → Team, the invite page and the workspace switcher.
 *
 * Each re-establishes the actor from the session; ids in the arguments only *name* a record, and the
 * service decides whether the actor may touch it (NOT_FOUND for a non-member, FORBIDDEN for a member
 * without the role). The workspace an invite is created in is always the session's active one.
 *
 * They are called directly from client components (not through `useActionState`), so each returns a
 * plain, serialisable result instead of form state.
 */

export type TeamActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

async function run<T extends object>(operation: () => Promise<T>): Promise<TeamActionResult<T>> {
  try {
    const data = await operation();
    revalidatePath(routes.settings);
    return { ok: true, ...data };
  } catch (error) {
    const { code, message } = toPublicError(error);
    const fieldErrors =
      error instanceof Object && "fieldErrors" in error
        ? (error.fieldErrors as Record<string, string[]> | undefined)
        : undefined;
    return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
  }
}

export async function inviteMembersAction(input: {
  emails: string;
  role: string;
}): Promise<TeamActionResult<{ emails: string[] }>> {
  return run(async () => {
    const user = await requireUser();
    return teamService.inviteMembers(user.id, user.workspaceId, {
      emails: input?.emails,
      role: input?.role,
    });
  });
}

export async function resendInviteAction(
  inviteId: string,
): Promise<TeamActionResult<{ email: string }>> {
  return run(async () => {
    const user = await requireUser();
    return teamService.resendInvite(user.id, inviteId);
  });
}

export async function revokeInviteAction(
  inviteId: string,
): Promise<TeamActionResult<{ email: string }>> {
  return run(async () => {
    const user = await requireUser();
    return teamService.revokeInvite(user.id, inviteId);
  });
}

export async function changeMemberRoleAction(
  membershipId: string,
  role: string,
): Promise<TeamActionResult<{ name: string; role: string }>> {
  return run(async () => {
    const user = await requireUser();
    return teamService.changeMemberRole(user.id, membershipId, role);
  });
}

export async function removeMemberAction(
  membershipId: string,
): Promise<TeamActionResult<{ name: string; workspaceName: string }>> {
  return run(async () => {
    const user = await requireUser();
    return teamService.removeMember(user.id, membershipId);
  });
}

export interface WorkspaceMenu {
  currentId: string;
  workspaces: { id: string; name: string; role: string }[];
}

/** The account menu's workspace list. Empty for an anonymous caller. */
export async function workspaceMenuAction(): Promise<WorkspaceMenu> {
  const user = await requireUser().catch(() => null);
  if (!user) return { currentId: "", workspaces: [] };
  const list = await teamService.listMyWorkspaces(user.id);
  return {
    currentId: user.workspaceId,
    workspaces: list.map((w) => ({ id: w.id, name: w.name, role: roleLabel(w.role) })),
  };
}

/** Makes another of the actor's workspaces current. The caller refreshes the page. */
export async function switchWorkspaceAction(workspaceId: string): Promise<TeamActionResult> {
  const result = await run(async () => {
    const user = await requireUser();
    await teamService.switchWorkspace(user.id, workspaceId);
    return {};
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/**
 * The invite page's "Accept invite" form, for a signed-in user. On success, lands in the workspace's
 * dashboard; on failure, back on the invite page, which explains the invite's state.
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const user = await requireUser().catch(() => null);
  if (!user) redirect(`${routes.login}?callbackUrl=${encodeURIComponent(invitePath(token))}`);

  let accepted = false;
  try {
    await teamService.acceptInvite(user.id, token);
    accepted = true;
  } catch (error) {
    toPublicError(error);
  }
  // Outside the try: redirect() signals by throwing.
  if (accepted) {
    revalidatePath("/", "layout");
    redirect(AFTER_SIGN_IN);
  }
  redirect(`${invitePath(token)}?failed=1`);
}

/**
 * The invite page's "Continue with Google". Remembers the invite in a short-lived httpOnly cookie
 * so that, if Google sign-in creates a new account, the adapter joins it to the inviting workspace
 * instead of creating a personal one (`server/auth/adapter.ts`). An existing account simply
 * returns to the invite page signed in and accepts there.
 *
 * The cookie holds the raw token, which is already a bearer secret delivered by email; it grants
 * nothing by itself — the adapter re-validates it and requires the Google address to match.
 */
export async function continueInviteWithGoogle(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const invite = await teamService.findPendingInvite(token);
  if (!invite) redirect(invitePath(token));

  const jar = await cookies();
  jar.set(INVITE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE_S,
  });

  try {
    await signIn("google", { redirectTo: invitePath(token) });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[routely] invite sign-in failed", error);
    redirect(`${routes.login}?error=Configuration`);
  }
}

/** The invite page's "Sign out and switch account": signs out and returns to the invite. */
export async function signOutForInvite(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  await signOut({ redirectTo: invitePath(token) });
}

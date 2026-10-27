"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { GUIDE_HIDDEN_COOKIE, SHEETS_SKIPPED_COOKIE } from "@/lib/onboarding";
import { routes } from "@/lib/routes";
import { requireUser } from "@/server/auth/session";

/**
 * Hiding and re-showing the Dashboard's "Getting started" checklist, and skipping its optional
 * Google Sheets step. Per-browser preferences in cookies, not columns: it changes nothing anyone else sees, the checklist's progress comes from the
 * workspace's real state either way, and Help & Guides can bring it back at any time.
 */

const ONE_YEAR_S = 365 * 24 * 60 * 60;

async function setFlag(name: string): Promise<void> {
  (await cookies()).set(name, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_S,
  });
}

export async function hideChecklistAction(): Promise<void> {
  await requireUser();
  await setFlag(GUIDE_HIDDEN_COOKIE);
  revalidatePath(routes.dashboard);
}

export async function skipSheetsStepAction(): Promise<void> {
  await requireUser();
  await setFlag(SHEETS_SKIPPED_COOKIE);
  revalidatePath(routes.dashboard);
  revalidatePath(routes.help.index);
}

export async function showChecklistAction(): Promise<void> {
  await requireUser();
  (await cookies()).delete(GUIDE_HIDDEN_COOKIE);
  revalidatePath(routes.dashboard);
  revalidatePath(routes.help.index);
}

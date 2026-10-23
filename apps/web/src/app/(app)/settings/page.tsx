import type { Metadata } from "next";

import {
  SettingsView,
  type SettingsNotice,
  type SettingsTab,
} from "@/components/settings/settings-view";
import { SETTINGS_VIEWS } from "@/lib/mock/settings";
import { readView, type SearchParams } from "@/lib/view-param";
import { requireSession } from "@/server/auth/session";
import { readViewerTimeZone } from "@/server/http/viewer-time-zone";
import { getAccountSettings } from "@/server/services/account.service";
import { getTeamOverview } from "@/server/services/team.service";

export const metadata: Metadata = { title: "Settings" };

const TAB_PARAM: Record<string, SettingsTab> = {
  profile: "profile",
  team: "team",
  notifications: "notif",
};

/** What `GET /settings/email/confirm` reports back through `?emailChanged=`. */
function emailNotice(value: string | undefined, email: string): SettingsNotice | null {
  if (value === "1") return { title: "Email updated", note: `Routely now uses ${email}.` };
  if (value === "taken") {
    return {
      title: "Email not changed",
      note: "That email is already used by another Routely account.",
    };
  }
  if (value === "invalid") {
    return {
      title: "That link has expired",
      note: "Confirmation links work once, for 24 hours. Change your email again to get a new one.",
    };
  }
  return null;
}

/**
 * Settings — profile & security, team members and email notifications, for the signed-in account
 * in its active workspace.
 *
 * `?tab=notifications|team` opens a section (notification emails link to the former);
 * `?view=` opens any of the design's states (see `lib/view-param.ts`), laid over the real data.
 */
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requireSession("/settings");
  const params = await searchParams;
  const view = readView(params["view"], SETTINGS_VIEWS, "profile");
  const tabParam = Array.isArray(params["tab"]) ? params["tab"][0] : params["tab"];
  const changed = Array.isArray(params["emailChanged"])
    ? params["emailChanged"][0]
    : params["emailChanged"];

  const timeZone = await readViewerTimeZone();
  const [account, team] = await Promise.all([
    getAccountSettings(user.id, user.sessionId, user.workspaceId),
    getTeamOverview(user.id, user.workspaceId, timeZone),
  ]);

  return (
    // Keyed so switching `?view=` on the client re-initialises the screen instead of keeping state.
    <SettingsView
      key={`${view}:${tabParam ?? ""}`}
      view={view}
      tab={TAB_PARAM[tabParam ?? ""] ?? "profile"}
      account={account}
      team={team}
      timeZone={timeZone}
      notice={emailNotice(changed, account.email)}
    />
  );
}

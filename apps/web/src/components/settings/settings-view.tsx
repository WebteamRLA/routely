"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Svg } from "@/components/rt/icons";
import { ToastHost, useToast } from "@/components/rt/toast";
import { focusRing, pageDescription, pageTitle } from "@/components/rt/styles";
import { NotificationsTab, type SaveStatus } from "@/components/settings/notifications-tab";
import { ConfirmDialog } from "@/components/settings/parts";
import {
  EMPTY_PASSWORD,
  ProfileTab,
  type PasswordState,
  type ProfileState,
} from "@/components/settings/profile-tab";
import { TeamTab } from "@/components/settings/team-tab";
import { useViewerTimeZone } from "@/components/experiment/use-viewer-time-zone";
import type { AccountNotification, AccountSession, AccountSettings } from "@/lib/account";
import type { TeamOverview } from "@/lib/team";
import { cn } from "@/lib/utils";
import {
  cancelEmailChangeAction,
  changePasswordAction,
  resendEmailChangeAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  setNotificationPreferenceAction,
  updateProfileAction,
} from "@/server/actions/account.actions";

export type SettingsTab = "profile" | "team" | "notif";

/** A message to toast once on arrival, e.g. after following an email-change link. */
export interface SettingsNotice {
  title: string;
  note: string;
}

const TABS: { key: SettingsTab; label: string; icon: ReactNode }[] = [
  {
    key: "profile",
    label: "Profile & security",
    icon: (
      <Svg size={17} strokeWidth={1.8}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </Svg>
    ),
  },
  {
    key: "team",
    label: "Team members",
    icon: (
      <Svg size={17} strokeWidth={1.8}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
        <path d="M18 14a6 6 0 0 1 3.5 6" />
      </Svg>
    ),
  },
  {
    key: "notif",
    label: "Notifications",
    icon: (
      <Svg size={17} strokeWidth={1.8}>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
      </Svg>
    ),
  },
];

const TEAM_VIEWS = ["team", "invite", "inviteErrors", "roleMenu", "removeMember"];

/**
 * The state the screen opens in: the account's real data, with the design's purely visual
 * `?view=` states (a form's error display, a confirmation dialog) laid over it for review.
 */
function initialState(view: string, tab: SettingsTab, data: AccountSettings) {
  const profile: ProfileState = {
    savedName: data.name,
    savedEmail: data.email,
    name: data.name,
    email: data.email,
    attempted: false,
    busy: false,
    pending: data.pendingEmail,
    serverError: null,
  };
  const pw: PasswordState = { ...EMPTY_PASSWORD, lastChanged: data.passwordNote };
  let modal: "signOut" | null = null;
  let openTab = tab;

  if (view === "profileErrors") {
    Object.assign(profile, {
      name: "",
      email: data.email.replace(/\.[^.@]+$/, ""),
      attempted: true,
    });
  }
  if (view === "emailPending" && !profile.pending) {
    profile.pending = `new.${data.email}`;
  }
  if (view === "passwordErrors") {
    Object.assign(pw, { cur: "TrailMix24", next: "pine7", confirm: "pine77", attempted: true });
  }
  if (view === "passwordWrong") {
    Object.assign(pw, {
      cur: "TrailMix42",
      next: "Campfire-2026",
      confirm: "Campfire-2026",
      attempted: true,
      serverErr: true,
    });
  }
  if (view === "signOutOthers") modal = "signOut";
  if (TEAM_VIEWS.includes(view)) openTab = "team";
  if (view === "notifications") openTab = "notif";
  return { profile, pw, modal, tab: openTab };
}

/**
 * Settings — Profile & security, Team members and Notifications, switched in-page from the
 * section nav as in the design (the tab is not written back to the URL).
 *
 * Profile, password, sessions and notifications run on the account actions; the Team tab is
 * self-contained (`TeamTab` owns its dialogs and actions).
 */
export function SettingsView({
  view,
  tab: initialTab,
  account,
  team,
  timeZone,
  notice,
}: {
  view: string;
  tab: SettingsTab;
  account: AccountSettings;
  team: TeamOverview | null;
  /** The zone the server formatted times in; corrected to the browser's on first visit. */
  timeZone: string;
  notice: SettingsNotice | null;
}) {
  const router = useRouter();
  useViewerTimeZone(timeZone);
  const [init] = useState(() => initialState(view, initialTab, account));
  const [tab, setTab] = useState<SettingsTab>(init.tab);
  const [profile, setProfile] = useState<ProfileState>(init.profile);
  const [pw, setPw] = useState<PasswordState>(init.pw);
  const [hasPassword, setHasPassword] = useState(account.hasPassword);
  const [sessions, setSessions] = useState<AccountSession[]>(account.sessions);
  const [sessBusy, setSessBusy] = useState<string | null>(null);
  const [soBusy, setSoBusy] = useState(false);
  const [modal, setModal] = useState(init.modal);
  const [notifs, setNotifs] = useState<AccountNotification[]>(account.notifications);
  const [ntStatus, setNtStatus] = useState<SaveStatus>("idle");
  const ntPending = useRef(0);
  const { toast, notify } = useToast();

  // Arriving from an emailed link (`?emailChanged=…`): say what happened, once.
  const announced = useRef(false);
  useEffect(() => {
    if (notice && !announced.current) {
      announced.current = true;
      notify(notice.title, notice.note);
    }
  }, [notice, notify]);

  const otherMemberEmails = (team?.members ?? [])
    .filter((m) => !m.isYou)
    .map((m) => m.email.toLowerCase());
  const workspaceName = team?.workspaceName ?? account.workspaceName;

  // ---- Profile ----
  async function saveProfile(hasErrors: boolean) {
    if (profile.busy) return;
    if (hasErrors) {
      setProfile({ ...profile, attempted: true });
      return;
    }
    const snapshot = profile;
    setProfile({ ...profile, attempted: true, busy: true, serverError: null });
    const result = await updateProfileAction({
      name: snapshot.name.trim(),
      email: snapshot.email.trim().toLowerCase(),
    });
    if (!result.ok) {
      setProfile((p) => ({
        ...p,
        busy: false,
        serverError: result.fieldErrors?.["email"] ?? null,
      }));
      if (!result.fieldErrors?.["email"] && !result.fieldErrors?.["name"]) {
        notify("Profile not saved", result.message);
      }
      return;
    }
    const data = result.data;
    setProfile((p) => ({
      ...p,
      busy: false,
      attempted: false,
      savedName: data.name,
      name: data.name,
      email: p.savedEmail,
      pending: data.kind === "emailPending" ? data.pendingEmail : p.pending,
    }));
    if (data.kind === "emailPending") {
      notify("Confirmation link sent", `Check ${data.pendingEmail} to finish changing your email.`);
    } else {
      notify("Profile saved", "Your team will see the update right away.");
    }
    router.refresh();
  }

  async function resendEmail() {
    const result = await resendEmailChangeAction();
    if (result.ok) {
      notify("Link sent again", `Check ${result.data.pendingEmail} for the new confirmation link.`);
    } else {
      notify("Link not sent", result.message);
    }
  }

  async function cancelEmail() {
    const result = await cancelEmailChangeAction();
    if (!result.ok) {
      notify("Couldn’t cancel the change", result.message);
      return;
    }
    setProfile((p) => ({ ...p, pending: null }));
    notify("Email change cancelled", `Routely will keep using ${result.data.savedEmail}.`);
  }

  // ---- Password ----
  async function savePassword(hasErrors: boolean) {
    if (pw.busy) return;
    if (hasErrors) {
      setPw({ ...pw, attempted: true });
      return;
    }
    const wasSet = hasPassword;
    setPw({ ...pw, attempted: true, busy: true, serverErr: false });
    const result = await changePasswordAction({
      current: pw.cur,
      next: pw.next,
      confirm: pw.confirm,
    });
    if (!result.ok) {
      const wrong = result.code === "UNAUTHENTICATED" && result.message.startsWith("That’s not");
      setPw((w) => ({ ...w, busy: false, serverErr: wrong }));
      if (!wrong) notify("Password not updated", result.message);
      return;
    }
    setHasPassword(true);
    setPw({ ...EMPTY_PASSWORD, lastChanged: result.data.passwordNote });
    if (wasSet) {
      notify(
        "Password updated",
        "Other sessions stay signed in. Sign out of them below if you need to.",
      );
    } else {
      notify("Password set", "You can now sign in with your email and this password.");
    }
  }

  // ---- Sessions ----
  async function signOutSession(d: AccountSession) {
    if (sessBusy) return;
    setSessBusy(d.id);
    const result = await revokeSessionAction(d.id);
    setSessBusy(null);
    // Gone either way: signed out now, or already gone (expired, or signed out elsewhere).
    setSessions((all) => all.filter((x) => x.id !== d.id));
    if (result.ok) notify(`Signed out of ${d.device}`, "That session will need to sign in again.");
    else notify("Already signed out", result.message);
  }

  const others = sessions.filter((d) => !d.current).length;

  async function confirmSignOut() {
    if (soBusy) return;
    setSoBusy(true);
    const result = await revokeOtherSessionsAction();
    setSoBusy(false);
    setModal(null);
    if (!result.ok) {
      notify("Couldn’t sign out", result.message);
      return;
    }
    const n = result.data.count;
    setSessions((all) => all.filter((d) => d.current));
    notify(
      `Signed out of ${n} ${n === 1 ? "session" : "sessions"}`,
      "Only this device is signed in now.",
    );
  }

  function closeModal() {
    if (soBusy) return;
    setModal(null);
  }

  // ---- Notifications ----
  async function toggleNotif(id: string) {
    const item = notifs.find((x) => x.id === id);
    if (!item) return;
    const enabled = !item.on;
    setNotifs((all) => all.map((x) => (x.id === id ? { ...x, on: enabled } : x)));
    setNtStatus("saving");
    ntPending.current += 1;
    const result = await setNotificationPreferenceAction(id, enabled);
    ntPending.current -= 1;
    if (!result.ok) {
      setNotifs((all) => all.map((x) => (x.id === id ? { ...x, on: !enabled } : x)));
      notify("Change not saved", result.message);
    }
    if (ntPending.current === 0) setNtStatus(result.ok ? "saved" : "idle");
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className={pageTitle}>Settings</h1>
        <p className={pageDescription}>
          Manage your profile, your team and the emails Routely sends you.
        </p>
      </header>

      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-8 max-[961px]:grid-cols-[minmax(0,1fr)] max-[961px]:gap-4">
        <nav
          aria-label="Settings sections"
          className="sticky top-6 flex min-w-0 flex-col gap-0.5 max-[961px]:static max-[961px]:flex-row max-[961px]:gap-1 max-[961px]:overflow-x-auto max-[961px]:pb-0.5"
        >
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                aria-current={on}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex h-9 cursor-pointer items-center gap-2.5 rounded-lg border-0 px-3 text-left text-[13px] whitespace-nowrap hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] max-[961px]:flex-none",
                  focusRing,
                )}
                style={{
                  background: on ? "#F1F3F5" : "transparent",
                  color: on ? "#111827" : "#374151",
                  fontWeight: on ? 600 : 500,
                }}
              >
                {t.icon}
                <span className="flex-auto">{t.label}</span>
                {t.key === "team" && team ? (
                  <span className="inline-flex h-6 min-w-[22px] items-center justify-center rounded-md bg-[#F3F4F6] px-2 text-xs font-semibold text-[#4B5563]">
                    {team.members.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="flex max-w-[880px] min-w-0 flex-col gap-5">
          {tab === "profile" ? (
            <ProfileTab
              profile={profile}
              pw={pw}
              roleLabel={account.roleLabel}
              workspaceName={workspaceName}
              otherMemberEmails={otherMemberEmails}
              hasPassword={hasPassword}
              sessions={sessions}
              sessBusy={sessBusy}
              onProfile={(patch) => setProfile((p) => ({ ...p, ...patch }))}
              onResetProfile={() =>
                setProfile((p) => ({
                  ...p,
                  name: p.savedName,
                  email: p.savedEmail,
                  attempted: false,
                  serverError: null,
                }))
              }
              onSaveProfile={saveProfile}
              onResendEmail={resendEmail}
              onCancelEmail={cancelEmail}
              onPw={(patch) => setPw((w) => ({ ...w, ...patch }))}
              onSavePassword={savePassword}
              onSignOutSession={signOutSession}
              onAskSignOut={() => setModal("signOut")}
            />
          ) : null}
          {tab === "team" && team ? <TeamTab team={team} view={view} notify={notify} /> : null}
          {tab === "notif" ? (
            <NotificationsTab
              email={profile.savedEmail}
              items={notifs}
              status={ntStatus}
              onToggle={toggleNotif}
            />
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={modal === "signOut"}
        title={`Sign out of ${others} ${others === 1 ? "other session?" : "other sessions?"}`}
        body="You’ll stay signed in on this device. Anyone using those sessions will need to sign in again."
        action={soBusy ? "Signing out…" : "Sign out"}
        busy={soBusy}
        onCancel={closeModal}
        onConfirm={confirmSignOut}
      />
      <ToastHost toast={toast} />
    </div>
  );
}

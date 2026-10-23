/**
 * Settings' states, seed data and validation, from the design's `Settings` screen.
 *
 * Lives outside the `"use client"` view so the server page can read `SETTINGS_VIEWS`. Everything
 * here is mock: no profile, password, session or team change reaches a server yet.
 */

export const SETTINGS_VIEWS = [
  "profile",
  "profileErrors",
  "emailPending",
  "passwordErrors",
  "passwordWrong",
  "signOutOthers",
  "team",
  "invite",
  "inviteErrors",
  "roleMenu",
  "removeMember",
  "notifications",
] as const;
export type SettingsViewName = (typeof SETTINGS_VIEWS)[number];

export type SettingsTab = "profile" | "team" | "notif";
export type Role = "Owner" | "Admin" | "Editor" | "Viewer";
export type AssignableRole = Exclude<Role, "Owner">;

export const WORKSPACE = "Fernwood Group";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  last: string;
  you?: boolean;
  initials: string;
  bg: string;
  ink: string;
}

export interface Invite {
  id: string;
  email: string;
  role: AssignableRole;
  sent: string;
  expires: string;
  by: string;
}

export interface Session {
  id: string;
  device: string;
  where: string;
  when: string;
  current?: boolean;
  kind: "laptop" | "phone";
}

export interface NotificationPref {
  id: string;
  title: string;
  desc: string;
  on: boolean;
}

export const SEED_MEMBERS: Member[] = [
  {
    id: "m1",
    name: "Alex Morgan",
    email: "alex@fernwoodsupply.com",
    role: "Owner",
    last: "Active now",
    you: true,
    initials: "AM",
    bg: "#DBEAFE",
    ink: "#1E40AF",
  },
  {
    id: "m2",
    name: "Jamie Lee",
    email: "jamie@fernwoodsupply.com",
    role: "Admin",
    last: "Today, 9:12 AM",
    initials: "JL",
    bg: "#E0E7FF",
    ink: "#3730A3",
  },
  {
    id: "m3",
    name: "Priya Shah",
    email: "priya@fernwoodsupply.com",
    role: "Editor",
    last: "Yesterday, 4:40 PM",
    initials: "PS",
    bg: "#E0E7FF",
    ink: "#3730A3",
  },
  {
    id: "m4",
    name: "Marcus Webb",
    email: "marcus@northbeamstudio.com",
    role: "Editor",
    last: "Oct 8, 2026",
    initials: "MW",
    bg: "#EDE9FE",
    ink: "#5B21B6",
  },
  {
    id: "m5",
    name: "Dana Ortiz",
    email: "dana@fernwoodsupply.com",
    role: "Viewer",
    last: "Sep 30, 2026",
    initials: "DO",
    bg: "#EDE9FE",
    ink: "#5B21B6",
  },
];

export const SEED_INVITES: Invite[] = [
  {
    id: "i1",
    email: "sam@fernwoodsupply.com",
    role: "Editor",
    sent: "Oct 11",
    expires: "Expires in 5 days",
    by: "Alex Morgan",
  },
];

export const SEED_SESSIONS: Session[] = [
  {
    id: "d1",
    device: "Chrome on macOS",
    where: "Portland, US",
    when: "Active now",
    current: true,
    kind: "laptop",
  },
  {
    id: "d2",
    device: "Safari on iPhone",
    where: "Portland, US",
    when: "2 hours ago",
    kind: "phone",
  },
  {
    id: "d3",
    device: "Edge on Windows",
    where: "Seattle, US",
    when: "Oct 9, 2026",
    kind: "laptop",
  },
];

export const ROLE_DEFS: { label: AssignableRole; desc: string }[] = [
  {
    label: "Admin",
    desc: "Manages projects, team members and integrations, plus everything Editors can do.",
  },
  { label: "Editor", desc: "Creates, edits, launches and pauses experiments." },
  { label: "Viewer", desc: "Sees experiments and results but can’t change anything." },
];

export const ROLE_INFO: { label: Role; desc: string }[] = [
  {
    label: "Owner",
    desc: "Everything Admins can do. There’s one owner, and they can’t be removed.",
  },
  ...ROLE_DEFS,
];

export const SEED_NOTIFICATIONS: NotificationPref[] = [
  {
    id: "result",
    title: "A result is ready",
    desc: "An experiment has enough data for Routely to suggest a winner.",
    on: true,
  },
  {
    id: "tracking",
    title: "Tracking stops",
    desc: "Routely hasn’t received any events from a project’s site for 24 hours.",
    on: true,
  },
  {
    id: "sheets",
    title: "Google Sheets sync fails",
    desc: "Routely can’t write to a project’s linked spreadsheet.",
    on: true,
  },
  {
    id: "paused",
    title: "An experiment is paused",
    desc: "Someone on your team pauses a running experiment.",
    on: false,
  },
];

export interface ProfileState {
  savedName: string;
  savedEmail: string;
  name: string;
  email: string;
  attempted: boolean;
  busy: boolean;
  pending: string | null;
}

export interface PasswordState {
  cur: string;
  next: string;
  confirm: string;
  show: boolean;
  attempted: boolean;
  busy: boolean;
  serverErr: boolean;
  lastChanged: string;
}

export interface InviteForm {
  emails: string;
  role: AssignableRole;
  attempted: boolean;
  busy: boolean;
}

export type SettingsModal = "invite" | "remove" | "signOut" | null;

export interface SettingsState {
  tab: SettingsTab;
  profile: ProfileState;
  pw: PasswordState;
  modal: SettingsModal;
  inv: InviteForm;
  rmId: string | null;
  /** The member whose role menu is open (`roleMenu` opens on Priya). */
  roleMenu: string | null;
}

export const EMPTY_PASSWORD: PasswordState = {
  cur: "",
  next: "",
  confirm: "",
  show: false,
  attempted: false,
  busy: false,
  serverErr: false,
  lastChanged: "Last changed Aug 2, 2026.",
};

export const EMPTY_INVITE: InviteForm = {
  emails: "",
  role: "Editor",
  attempted: false,
  busy: false,
};

/** The state each design view opens in — mirrors the reference's `init(view)`. */
export function initialSettings(view: SettingsViewName): SettingsState {
  const st: SettingsState = {
    tab: "profile",
    profile: {
      savedName: "Alex Morgan",
      savedEmail: "alex@fernwoodsupply.com",
      name: "Alex Morgan",
      email: "alex@fernwoodsupply.com",
      attempted: false,
      busy: false,
      pending: null,
    },
    pw: { ...EMPTY_PASSWORD },
    modal: null,
    inv: { ...EMPTY_INVITE },
    rmId: null,
    roleMenu: null,
  };
  if (view === "profileErrors")
    st.profile = { ...st.profile, name: "", email: "alex@fernwood", attempted: true };
  if (view === "emailPending") st.profile.pending = "alex.morgan@fernwoodsupply.com";
  if (view === "passwordErrors")
    st.pw = { ...st.pw, cur: "TrailMix24", next: "pine7", confirm: "pine77", attempted: true };
  if (view === "passwordWrong")
    st.pw = {
      ...st.pw,
      cur: "TrailMix42",
      next: "Campfire-2026",
      confirm: "Campfire-2026",
      attempted: true,
      serverErr: true,
    };
  if (view === "signOutOthers") st.modal = "signOut";
  if (["team", "invite", "inviteErrors", "roleMenu", "removeMember"].includes(view))
    st.tab = "team";
  if (view === "invite") {
    st.modal = "invite";
    st.inv.emails = "leo@fernwoodsupply.com, mia@northbeamstudio.com";
  }
  if (view === "inviteErrors") {
    st.modal = "invite";
    st.inv = { ...st.inv, emails: "jamie@fernwoodsupply.com, mia@northbeam", attempted: true };
  }
  if (view === "roleMenu") st.roleMenu = "m3";
  if (view === "removeMember") {
    st.modal = "remove";
    st.rmId = "m3";
  }
  if (view === "notifications") st.tab = "notif";
  return st;
}

export function validEmail(e: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(String(e || "").trim());
}

export function profileErrors(p: Pick<ProfileState, "name" | "email">, members: Member[]) {
  const e = { name: "", email: "" };
  const n = p.name.trim();
  const em = p.email.trim().toLowerCase();
  if (!n) e.name = "Enter your name.";
  else if (n.length > 80) e.name = "Use 80 characters or fewer.";
  if (!em) e.email = "Enter your email address.";
  else if (!validEmail(em)) e.email = "Enter a valid email address, like name@company.com.";
  else if (members.some((m) => !m.you && m.email === em))
    e.email = `That email belongs to another member of ${WORKSPACE}.`;
  return e;
}

export function passwordErrors(pw: Pick<PasswordState, "cur" | "next" | "confirm">) {
  const e = { cur: "", next: "", confirm: "" };
  if (!pw.cur) e.cur = "Enter your current password.";
  if (!pw.next) e.next = "Enter a new password.";
  else if (pw.next.length < 8) e.next = "Use at least 8 characters.";
  else if (pw.next === pw.cur) e.next = "Choose a password that’s different from your current one.";
  if (!pw.confirm) e.confirm = "Enter the new password again.";
  else if (pw.confirm !== pw.next) e.confirm = "Passwords don’t match.";
  return e;
}

/** Splits on commas, semicolons and whitespace; lower-cased and de-duplicated. */
export function parseInviteEmails(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => {
      if (!x || seen.has(x)) return false;
      seen.add(x);
      return true;
    });
}

export function inviteErrors(emails: string, members: Member[], invites: Invite[]): string[] {
  const list = parseInviteEmails(emails);
  if (!list.length) return ["Enter at least one email address."];
  const out: string[] = [];
  const bad = list.filter((x) => !validEmail(x));
  if (bad.length)
    out.push(
      `${bad.length === 1 ? "Check this address: " : "Check these addresses: "}${bad.join(", ")}`,
    );
  if (list.length > 10) out.push("You can invite up to 10 people at a time.");
  const onTeam = list.filter((x) => members.some((m) => m.email === x));
  if (onTeam.length)
    out.push(
      onTeam.length === 1
        ? `${onTeam[0]} is already on the team.`
        : `Already on the team: ${onTeam.join(", ")}`,
    );
  const invited = list.filter((x) => invites.some((i) => i.email === x));
  if (invited.length)
    out.push(
      invited.length === 1
        ? `${invited[0]} already has a pending invite.`
        : `Already invited: ${invited.join(", ")}`,
    );
  return out;
}

export function withArticle(role: string): string {
  return /^[AEIOU]/.test(role) ? `an ${role}` : `a ${role}`;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return (
    (words[0] ?? "").charAt(0) + (words.length > 1 ? (words[words.length - 1] ?? "").charAt(0) : "")
  ).toUpperCase();
}

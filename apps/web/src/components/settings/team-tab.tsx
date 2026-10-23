"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { CheckIcon, ChevronDownIcon, PlusIcon, Svg } from "@/components/rt/icons";
import { PopoverMenu } from "@/components/rt/popover-menu";
import { ACCENT, ACCENT_INK, ACCENT_TINT, focusRing } from "@/components/rt/styles";
import { ToastHost, useToast } from "@/components/rt/toast";
import { EMPTY_INVITE, InviteDialog, type InviteForm } from "@/components/settings/invite-dialog";
import { ConfirmDialog, SettingsCard, sbtn } from "@/components/settings/parts";
import {
  ASSIGNABLE_ROLES,
  ROLE_DESCRIPTIONS,
  inviteErrors,
  parseInviteEmails,
  withArticle,
  type AssignableRoleLabel,
  type TeamInvite,
  type TeamMember,
  type TeamOverview,
} from "@/lib/team";
import { cn } from "@/lib/utils";
import {
  changeMemberRoleAction,
  inviteMembersAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
} from "@/server/actions/team.actions";

/*
 * One grid for the header and every row. Below 960px the per-cell "Role" / "Last active" labels
 * appear; below 640px the header hides and each row re-flows into a small card.
 */
const GRID =
  "grid grid-cols-[minmax(200px,2fr)_170px_minmax(120px,1fr)_132px] items-center gap-x-3";
const ROW = cn(
  GRID,
  "min-h-16 px-3.5 py-3",
  "max-[641px]:grid-cols-2 max-[641px]:items-start max-[641px]:gap-y-2.5",
  "max-[641px]:[grid-template-areas:'mem_mem'_'role_last'_'act_act']",
);
const CELL_LABEL = "hidden text-[12px] text-[#6B7280] max-[961px]:block";

/** Avatar tints, in the design's order: the first row blue, the next two indigo, then violet. */
function avatarColors(index: number): { bg: string; ink: string } {
  if (index === 0) return { bg: "#DBEAFE", ink: "#1E40AF" };
  if (index < 3) return { bg: "#E0E7FF", ink: "#3730A3" };
  return { bg: "#EDE9FE", ink: "#5B21B6" };
}

/** "all 3 projects" as designed; "the 1 project" and "{Workspace}" where that would misread. */
function projectsPhrase(n: number, workspace: string): string {
  if (n === 0) return workspace;
  if (n === 1) return "the 1 project";
  return `all ${n} projects`;
}

/** `?view=` states of the Team tab that are purely visual. */
type TeamView = "invite" | "inviteErrors" | "roleMenu" | "removeMember";

/**
 * Settings → Team members, on real data.
 *
 * Self-contained: it owns the role menus, the invite dialog, the remove-member confirmation and the
 * server actions, so the settings shell only passes `team` (from `team.service.getTeamOverview`).
 * After each change the server re-renders the page (`revalidatePath`) and `team` arrives fresh;
 * nothing is simulated. Controls a member's role does not allow are not rendered — the actions
 * refuse them anyway.
 *
 * `view` opens the design's visual states (`?view=invite`, `inviteErrors`, `roleMenu`,
 * `removeMember`) against the real team. `notify` lets the shell's single toast be shared; without
 * it the tab renders its own.
 */
export function TeamTab({
  team,
  view,
  notify: notifyProp,
}: {
  team: TeamOverview;
  view?: string;
  notify?(title: string, note: string): void;
}) {
  const router = useRouter();
  const own = useToast();
  const notify = notifyProp ?? own.notify;
  const [, startRefresh] = useTransition();

  const manage = team.capabilities.manageTeam;
  const initialView = (manage ? view : undefined) as TeamView | undefined;
  const firstManageable = team.members.find((m) => m.manageable)?.id ?? null;

  const [roleMenu, setRoleMenu] = useState<string | null>(
    initialView === "roleMenu" ? firstManageable : null,
  );
  const [modal, setModal] = useState<"invite" | "remove" | null>(
    initialView === "invite" || initialView === "inviteErrors"
      ? "invite"
      : initialView === "removeMember" && firstManageable
        ? "remove"
        : null,
  );
  const [inv, setInv] = useState<InviteForm>(() => {
    if (initialView === "invite")
      return { ...EMPTY_INVITE, emails: "leo@fernwoodsupply.com, mia@northbeamstudio.com" };
    if (initialView === "inviteErrors")
      return {
        ...EMPTY_INVITE,
        emails: `${team.members[1]?.email ?? "jamie@fernwoodsupply.com"}, mia@northbeam`,
        attempted: true,
      };
    return EMPTY_INVITE;
  });
  const [rmId, setRmId] = useState<string | null>(
    initialView === "removeMember" ? firstManageable : null,
  );
  const [rmBusy, setRmBusy] = useState(false);
  /** Invite rows with a resend/revoke in flight, so a double click sends once. */
  const [busyInvites, setBusyInvites] = useState<ReadonlySet<string>>(new Set());

  const members = team.members;
  const invites = team.invites;
  const memberEmails = members.map((m) => m.email.toLowerCase());
  const pendingEmails = invites.filter((i) => !i.expired).map((i) => i.email);

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function pickRole(m: TeamMember, role: AssignableRoleLabel) {
    setRoleMenu(null);
    if (role === m.role) return;
    const result = await changeMemberRoleAction(m.id, role);
    if (!result.ok) return notify("Couldn’t change the role", result.message);
    notify(
      `${m.name} is now ${withArticle(role)}`,
      "The change applies to all projects right away.",
    );
    refresh();
  }

  async function withInviteBusy(id: string, task: () => Promise<void>) {
    if (busyInvites.has(id)) return;
    setBusyInvites((cur) => new Set(cur).add(id));
    try {
      await task();
    } finally {
      setBusyInvites((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
    }
  }

  function resendInvite(iv: TeamInvite) {
    void withInviteBusy(iv.id, async () => {
      const result = await resendInviteAction(iv.id);
      if (!result.ok) return notify("Couldn’t resend the invite", result.message);
      notify("Invite sent again", `${iv.email} has a new link that expires in 7 days.`);
      refresh();
    });
  }

  function revokeInvite(iv: TeamInvite) {
    void withInviteBusy(iv.id, async () => {
      const result = await revokeInviteAction(iv.id);
      if (!result.ok) return notify("Couldn’t revoke the invite", result.message);
      notify("Invite revoked", `${iv.email} can no longer use their invite link.`);
      refresh();
    });
  }

  function openInvite() {
    setRoleMenu(null);
    setInv({ ...EMPTY_INVITE });
    setModal("invite");
  }

  async function sendInvites() {
    if (inv.busy) return;
    if (inviteErrors(inv.emails, memberEmails, pendingEmails).length) {
      setInv({ ...inv, attempted: true });
      return;
    }
    const list = parseInviteEmails(inv.emails);
    setInv({ ...inv, attempted: true, busy: true, serverErrors: undefined });
    const result = await inviteMembersAction({ emails: inv.emails, role: inv.role });
    if (!result.ok) {
      setInv((cur) => ({
        ...cur,
        busy: false,
        serverErrors: result.fieldErrors?.emails ?? [result.message],
      }));
      return;
    }
    setInv((cur) => ({ ...cur, busy: false }));
    setModal(null);
    if (list.length === 1) notify("Invite sent", `${list[0]} will get an email from Routely.`);
    else notify(`${list.length} invites sent`, "Each person will get an email from Routely.");
    refresh();
  }

  const rmMember = rmId ? members.find((m) => m.id === rmId) : undefined;
  const projects = team.projectCount;

  async function confirmRemove() {
    if (rmBusy || !rmMember) return;
    const m = rmMember;
    setRmBusy(true);
    const result = await removeMemberAction(m.id);
    setRmBusy(false);
    setModal(null);
    setRmId(null);
    if (!result.ok) return notify("Couldn’t remove the member", result.message);
    notify(`${m.name} removed`, `They no longer have access to ${team.workspaceName}.`);
    refresh();
  }

  function closeModal() {
    if (inv.busy || rmBusy) return;
    setModal(null);
    setRmId(null);
  }

  const n = invites.length;
  const summary =
    `${members.length} ${members.length === 1 ? "member" : "members"}` +
    (n ? ` · ${n} ${n === 1 ? "pending invite" : "pending invites"}` : "");

  return (
    <>
      <SettingsCard
        id="st-team"
        title="Team members"
        description={
          <p aria-live="polite" className="m-0 text-sm leading-5 text-pretty text-[#4B5563]">
            {summary}
          </p>
        }
        headerClassName="max-[641px]:[&>button]:w-full"
        aside={
          manage ? (
            <button type="button" onClick={openInvite} className={sbtn.primary}>
              <PlusIcon size={17} />
              Invite members
            </button>
          ) : undefined
        }
      >
        <div className="px-6 pt-[18px] pb-6 max-[641px]:px-4">
          <div
            role="table"
            aria-label="Team members"
            className="rounded-xl border border-[#EEF0F3]"
          >
            <div
              role="row"
              className={cn(
                GRID,
                "rounded-t-[11px] bg-[#FAFBFC] px-3.5 py-[9px] text-xs leading-4 font-medium text-[#6B7280] max-[641px]:hidden",
              )}
            >
              <span role="columnheader">Member</span>
              <span role="columnheader">Role</span>
              <span role="columnheader">Last active</span>
              <span role="columnheader" className="text-right">
                <span className="sr-only">Actions</span>
              </span>
            </div>
            {members.map((m, i) => (
              <MemberRow
                key={m.id}
                m={m}
                colors={avatarColors(i)}
                first={i === 0}
                open={roleMenu === m.id}
                onToggle={() => setRoleMenu((cur) => (cur === m.id ? null : m.id))}
                onClose={() => setRoleMenu(null)}
                onPick={(r) => void pickRole(m, r)}
                onRemove={() => {
                  setRoleMenu(null);
                  setRmId(m.id);
                  setModal("remove");
                }}
              />
            ))}
            {invites.map((iv, i) => (
              <div
                key={iv.id}
                role="row"
                className={ROW}
                style={{
                  borderTop: `1px solid ${members.length + i === 0 ? "transparent" : "#EEF0F3"}`,
                }}
              >
                <div
                  role="cell"
                  className="flex min-w-0 items-center gap-3 max-[641px]:[grid-area:mem]"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-[34px] flex-[0_0_34px] items-center justify-center rounded-full border-[1.5px] border-dashed border-[#D1D5DB] text-[#6B7280]"
                  >
                    <Svg size={15} strokeWidth={1.8}>
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 6 9-6" />
                    </Svg>
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm leading-5 font-semibold text-[#111827]">
                      {iv.email}
                    </span>
                    <span className="truncate text-[13px] leading-[18px] text-[#6B7280]">
                      Invited by {iv.invitedBy} on {iv.sentAt}
                    </span>
                  </span>
                </div>
                <div
                  role="cell"
                  className="relative flex min-w-0 flex-col items-start gap-0.5 max-[641px]:[grid-area:role]"
                >
                  <span className={CELL_LABEL}>Role</span>
                  <span className="inline-flex h-8 items-center text-sm font-medium text-[#374151]">
                    {iv.role}
                  </span>
                </div>
                <div
                  role="cell"
                  className="flex min-w-0 flex-col items-start gap-[3px] max-[641px]:[grid-area:last]"
                >
                  <span className={CELL_LABEL}>Last active</span>
                  {iv.expired ? (
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-[#F3F4F6] px-2 text-xs font-semibold whitespace-nowrap text-[#4B5563]">
                      <span aria-hidden className="size-1.5 rounded-full bg-[#9CA3AF]" />
                      Invite expired
                    </span>
                  ) : (
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-[#FEF3C7] px-2 text-xs font-semibold whitespace-nowrap text-[#92400E]">
                      <span aria-hidden className="size-1.5 rounded-full bg-[#F59E0B]" />
                      Invite pending
                    </span>
                  )}
                  <span className="text-[13px] leading-[18px] whitespace-nowrap text-[#6B7280]">
                    {iv.expiresAt}
                  </span>
                </div>
                <div
                  role="cell"
                  className="flex items-center justify-end gap-0.5 max-[641px]:-ml-2 max-[641px]:justify-start max-[641px]:[grid-area:act]"
                >
                  {manage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => resendInvite(iv)}
                        disabled={busyInvites.has(iv.id)}
                        aria-label={`Resend invite to ${iv.email}`}
                        className={cn(sbtn.text, "h-8 rounded-md px-2 text-[#374151]")}
                      >
                        Resend
                      </button>
                      <button
                        type="button"
                        onClick={() => revokeInvite(iv)}
                        disabled={busyInvites.has(iv.id)}
                        aria-label={`Revoke invite for ${iv.email}`}
                        className={cn(sbtn.text, "h-8 rounded-md px-2 text-[#B91C1C]")}
                      >
                        Revoke
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        id="st-roles"
        title="What each role can do"
        description={`Roles apply to every project in ${team.workspaceName}.`}
      >
        <div className="px-6 pt-2.5 pb-[18px] max-[641px]:px-4">
          <dl className="m-0">
            {ROLE_DESCRIPTIONS.map((r, i) => (
              <div
                key={r.label}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5"
                style={{ borderTop: `1px solid ${i === 0 ? "transparent" : "#EEF0F3"}` }}
              >
                <dt className="flex-[0_0_72px] text-[14px] font-semibold text-[#111827]">
                  {r.label}
                </dt>
                <dd className="m-0 flex-[1_1_260px] text-sm leading-5 text-[#374151]">{r.desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      </SettingsCard>

      <InviteDialog
        open={modal === "invite"}
        form={inv}
        workspaceName={team.workspaceName}
        memberEmails={memberEmails}
        pendingEmails={pendingEmails}
        onChange={(patch) => setInv((cur) => ({ ...cur, ...patch }))}
        onClose={closeModal}
        onSend={() => void sendInvites()}
      />
      <ConfirmDialog
        open={modal === "remove" && !!rmMember}
        title={`Remove ${rmMember?.name ?? ""} from ${team.workspaceName}?`}
        body={
          rmMember
            ? `${rmMember.name.split(" ")[0]} will lose access to ${projectsPhrase(projects, team.workspaceName)} right away. Experiments they created stay, and you can invite them again later.`
            : ""
        }
        action={rmBusy ? "Removing…" : "Remove member"}
        busy={rmBusy}
        onCancel={closeModal}
        onConfirm={() => void confirmRemove()}
      />
      {notifyProp ? null : <ToastHost toast={own.toast} />}
    </>
  );
}

function MemberRow({
  m,
  colors,
  first,
  open,
  onToggle,
  onClose,
  onPick,
  onRemove,
}: {
  m: TeamMember;
  colors: { bg: string; ink: string };
  first: boolean;
  open: boolean;
  onToggle(): void;
  onClose(): void;
  onPick(role: AssignableRoleLabel): void;
  onRemove(): void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const editable = m.manageable;
  return (
    <div
      role="row"
      className={ROW}
      style={{ borderTop: `1px solid ${first ? "transparent" : "#EEF0F3"}` }}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3 max-[641px]:[grid-area:mem]">
        <span
          aria-hidden
          className="inline-flex size-[34px] flex-[0_0_34px] items-center justify-center rounded-full text-[13px] font-bold"
          style={{ background: colors.bg, color: colors.ink }}
        >
          {m.initials}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm leading-5 font-semibold text-[#111827]">
              {m.name}
            </span>
            {m.isYou ? (
              <span
                className="inline-flex h-6 flex-none items-center rounded-md px-2 text-xs font-semibold"
                style={{ background: ACCENT_TINT, color: ACCENT_INK }}
              >
                You
              </span>
            ) : null}
          </span>
          <span className="truncate text-[13px] leading-[18px] text-[#6B7280]">{m.email}</span>
        </span>
      </div>
      <div
        role="cell"
        className="relative flex min-w-0 flex-col items-start gap-0.5 max-[641px]:[grid-area:role]"
      >
        <span className={CELL_LABEL}>Role</span>
        {editable ? (
          <>
            <button
              ref={trigger}
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`Role for ${m.name}: ${m.role}`}
              onClick={onToggle}
              className={cn(
                "relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white pr-2 pl-2.5 text-[13px] font-medium whitespace-nowrap text-[#374151] hover:bg-[#F9FAFB]",
                focusRing,
              )}
            >
              {m.role}
              <ChevronDownIcon size={15} className="text-[#6B7280]" />
            </button>
            <PopoverMenu
              open={open}
              onClose={onClose}
              triggerRef={trigger}
              label={`Change role for ${m.name}`}
              align="left"
              className="w-[290px] max-w-[calc(100vw-48px)]"
            >
              {ASSIGNABLE_ROLES.map((r) => {
                const sel = r.label === m.role;
                return (
                  <button
                    key={r.label}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sel}
                    onClick={() => onPick(r.label)}
                    className="flex w-full cursor-pointer items-start gap-2.5 rounded-md border-0 bg-white px-2.5 py-[9px] text-left text-[#111827] outline-none hover:bg-[#F3F4F6] focus-visible:bg-[#F3F4F6]"
                  >
                    <span className="flex min-w-0 flex-auto flex-col gap-0.5">
                      <span className="text-sm leading-[18px] font-semibold">{r.label}</span>
                      <span className="text-[13px] leading-[17px] whitespace-normal text-[#6B7280]">
                        {r.desc}
                      </span>
                    </span>
                    <span aria-hidden className="mt-px inline-flex size-4 flex-[0_0_16px]">
                      {sel ? <CheckIcon size={16} strokeWidth={2.2} stroke={ACCENT} /> : null}
                    </span>
                  </button>
                );
              })}
            </PopoverMenu>
          </>
        ) : (
          <span className="inline-flex h-8 items-center text-sm font-medium text-[#374151]">
            {m.role}
          </span>
        )}
      </div>
      <div
        role="cell"
        className="flex min-w-0 flex-col items-start gap-[3px] max-[641px]:[grid-area:last]"
      >
        <span className={CELL_LABEL}>Last active</span>
        <span className="text-sm leading-5 whitespace-nowrap text-[#374151]">{m.lastActive}</span>
      </div>
      <div
        role="cell"
        className="flex items-center justify-end gap-0.5 max-[641px]:-ml-2 max-[641px]:justify-start max-[641px]:[grid-area:act]"
      >
        {editable ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${m.name}`}
            className={cn(sbtn.text, "h-8 rounded-md px-2 text-[#B91C1C]")}
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

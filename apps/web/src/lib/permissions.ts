/**
 * Who may do what in a workspace — the permission matrix, as pure functions.
 *
 * The role descriptions the product shows are the source:
 * - Owner: "Everything Admins can do. There's one owner, and they can't be removed."
 * - Admin: "Manages projects, team members and integrations, plus everything Editors can do."
 * - Editor: "Creates, edits, launches and pauses experiments."
 * - Viewer: "Sees experiments and results but can't change anything."
 *
 * Pure and dependency-free so the client can use the same table to decide which controls to show
 * — but showing a button is never the check. The server folds `rolesWith(capability)` into the
 * `where` clause of the write itself (see `server/repositories/access.ts`), so a request that
 * skips the UI still matches nothing.
 *
 * `MemberRole` is spelled out here rather than imported from the generated Prisma client, so this
 * module stays importable from client components; the union is identical to the Prisma enum.
 */

export type MemberRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

/** Every role, most powerful first. */
export const MEMBER_ROLES: readonly MemberRole[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];

const RANK: Record<MemberRole, number> = { OWNER: 4, ADMIN: 3, EDITOR: 2, VIEWER: 1 };

/** True when `role` is `min` or more powerful. */
export function hasRole(role: MemberRole, min: MemberRole): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * Capabilities with a fixed minimum role. Rules that also depend on the target (deleting an
 * experiment, managing a particular member) are functions below instead.
 */
export const CAPABILITY_MIN_ROLE = {
  /** Projects, experiments, results, review and activity. */
  view: "VIEWER",
  /** Create, autosave, edit, launch, pause, resume and end experiments; the visual editor; an
   * experiment's tracking checks. */
  "experiment.edit": "EDITOR",
  /** Create, rotate or disable a public results link. */
  "share.manage": "EDITOR",
  /** Create, edit or delete a project (website). */
  "project.manage": "ADMIN",
  /** Verify a pixel installation (a rate-limited outbound fetch). */
  "pixel.verify": "EDITOR",
  /** Connect or revoke the Google grant; attach, create or detach a project's spreadsheet. */
  "sheets.manage": "ADMIN",
  /** Sheets "Sync now". */
  "sheets.sync": "EDITOR",
  /** Invite, resend or revoke invites; change roles; remove members (see `canManageMember`). */
  "team.manage": "ADMIN",
  /** Rename or delete the workspace, transfer ownership. */
  "workspace.manage": "OWNER",
} as const satisfies Record<string, MemberRole>;

export type Capability = keyof typeof CAPABILITY_MIN_ROLE;

export function can(role: MemberRole, capability: Capability): boolean {
  return hasRole(role, CAPABILITY_MIN_ROLE[capability]);
}

/** The roles that hold `capability`, for a `role: { in: … }` filter. */
export function rolesWith(capability: Capability): MemberRole[] {
  return rolesAtLeast(CAPABILITY_MIN_ROLE[capability]);
}

export function rolesAtLeast(min: MemberRole): MemberRole[] {
  return MEMBER_ROLES.filter((role) => hasRole(role, min));
}

type ExperimentStatusName = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";

/**
 * Deleting an experiment: Admins and the Owner may delete any; an Editor only a draft, because a
 * draft has collected nothing and is the Editor's own work in progress, whereas deleting a launched
 * test destroys results other people rely on.
 */
export function canDeleteExperiment(role: MemberRole, status: ExperimentStatusName): boolean {
  if (hasRole(role, "ADMIN")) return true;
  return role === "EDITOR" && status === "DRAFT";
}

/** The roles that may delete an experiment in `status`, for a `role: { in: … }` filter. */
export function rolesThatCanDeleteExperiment(status: ExperimentStatusName): MemberRole[] {
  return MEMBER_ROLES.filter((role) => canDeleteExperiment(role, status));
}

/** Roles an invitation may grant. Ownership is never granted by invitation. */
export const INVITABLE_ROLES: readonly MemberRole[] = ["ADMIN", "EDITOR", "VIEWER"];

export function canInviteAs(actor: MemberRole, role: MemberRole): boolean {
  return can(actor, "team.manage") && INVITABLE_ROLES.includes(role);
}

/**
 * Changing another member's role, or removing them. Admins manage every non-Owner — including
 * other Admins — and nobody manages the Owner. Nobody changes their own role or removes themselves
 * through this path (leaving a workspace is a different action).
 */
export function canManageMember(
  actor: MemberRole,
  target: MemberRole,
  options: { isSelf: boolean },
): boolean {
  if (options.isSelf) return false;
  if (target === "OWNER") return false;
  return can(actor, "team.manage");
}

/** Whether `actor` may set `target`'s role to `next`. The Owner role is only transferred. */
export function canChangeRole(
  actor: MemberRole,
  target: MemberRole,
  next: MemberRole,
  options: { isSelf: boolean },
): boolean {
  return canManageMember(actor, target, options) && next !== "OWNER";
}

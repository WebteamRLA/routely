/**
 * The wizard's unsaved-changes guard, as a tiny window-event contract (agreed with the wizard):
 *
 * - While a wizard has unsaved changes it sets `document.body.dataset.wizardDirty = "1"` and
 *   listens for `rl:leave-request`.
 * - Before switching project or logging out, the shell calls `requestLeave`. With a dirty wizard
 *   it dispatches `rl:leave-request` and does nothing else — the wizard shows its "switch" /
 *   "logout" modal and calls `detail.proceed()` once the user has saved or discarded.
 * - With no dirty wizard mounted, `proceed` runs immediately.
 */
export type LeaveKind = "switch" | "logout";

export interface LeaveRequestDetail {
  kind: LeaveKind;
  proceed: () => void;
  /** For "switch": the name of the project being switched to (modal copy). */
  targetName?: string;
}

export const LEAVE_REQUEST_EVENT = "rl:leave-request";

export function requestLeave(kind: LeaveKind, proceed: () => void, targetName?: string): void {
  if (typeof document !== "undefined" && document.body.dataset.wizardDirty === "1") {
    const detail: LeaveRequestDetail = { kind, proceed, targetName };
    window.dispatchEvent(new CustomEvent<LeaveRequestDetail>(LEAVE_REQUEST_EVENT, { detail }));
    return;
  }
  proceed();
}

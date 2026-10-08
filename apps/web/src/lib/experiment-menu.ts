/**
 * Row / header actions for an experiment by status (the prototype's `menuFor`). Returns keys
 * and labels only; callers attach the handlers.
 *
 * - draft: Continue setup · Duplicate · Delete
 * - running: View results · Pause · Duplicate
 * - paused: View results · Resume · Duplicate
 * - completed: View results · Duplicate · Delete
 */

import type { ExperimentStatusKey } from "./domain";

export type MenuActionKey = "continue" | "view" | "pause" | "resume" | "duplicate" | "delete";

export interface MenuAction {
  key: MenuActionKey;
  label: string;
  /** Danger actions are drawn in red (`#B4361F`); the rest in ink (`#0F1B35`). */
  danger: boolean;
  color: string;
}

const INK = "#0F1B35";
const DANGER = "#B4361F";

const LABELS: Record<MenuActionKey, string> = {
  continue: "Continue setup",
  view: "View results",
  pause: "Pause",
  resume: "Resume",
  duplicate: "Duplicate",
  delete: "Delete",
};

export function menuFor(status: ExperimentStatusKey): MenuAction[] {
  const keys: MenuActionKey[] = [];
  keys.push(status === "draft" ? "continue" : "view");
  if (status === "running") keys.push("pause");
  if (status === "paused") keys.push("resume");
  keys.push("duplicate");
  if (status === "draft" || status === "completed") keys.push("delete");
  return keys.map((key) => ({
    key,
    label: LABELS[key],
    danger: key === "delete",
    color: key === "delete" ? DANGER : INK,
  }));
}

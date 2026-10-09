import type { ExperimentDraft } from "@/lib/domain";

/**
 * The wizard's in-progress state in `sessionStorage`, so a refresh keeps it. Per tab, keyed by
 * project and experiment (or "new"), cleared when the wizard is left normally. Every access is
 * guarded: storage can be unavailable (private mode, blocked site data) and the wizard must work
 * without it.
 */
export interface StoredWizard {
  /** 2 = six steps (design v2); 1 = the old seven, with Variants third. */
  v: 2;
  draft: ExperimentDraft;
  step: number;
  maxStep: number;
  dirty: boolean;
  lastUrl: string | null;
}

export function storageKey(projectId: string, experimentId: string | null): string {
  return `rl:wizard:${projectId}:${experimentId ?? "new"}`;
}

/** A seven-step index (Type, Setup, Variants, Traffic, …) as a six-step one: Variants → Setup. */
function fromV1Step(i: number): number {
  return i <= 2 ? Math.min(i, 1) : i - 1;
}

/**
 * Validates a stored copy (parsed JSON) for this project. A copy written before design v2 — a
 * tab refreshed across the deploy — has its step indices moved onto the six steps.
 */
export function parseStored(parsed: unknown, projectId: string): StoredWizard | null {
  const p = parsed as (Omit<StoredWizard, "v"> & { v: number }) | null;
  if (!p || (p.v !== 1 && p.v !== 2) || !p.draft || p.draft.projectId !== projectId) return null;
  if (!Array.isArray(p.draft.arms) || p.draft.arms.length < 2) return null;
  const step = Number.isInteger(p.step) ? p.step : 0;
  const maxStep = Number.isInteger(p.maxStep) ? p.maxStep : step;
  if (p.v === 2) return { ...p, v: 2, step, maxStep };
  return { ...p, v: 2, step: fromV1Step(step), maxStep: fromV1Step(maxStep) };
}

export function readStored(key: string, projectId: string): StoredWizard | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return parseStored(JSON.parse(raw), projectId);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: StoredWizard): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the wizard keeps working, a refresh just won't restore it.
  }
}

export function clearStored(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

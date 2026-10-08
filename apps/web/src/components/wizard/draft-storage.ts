import type { ExperimentDraft } from "@/lib/domain";

/**
 * The wizard's in-progress state in `sessionStorage`, so a refresh keeps it. Per tab, keyed by
 * project and experiment (or "new"), cleared when the wizard is left normally. Every access is
 * guarded: storage can be unavailable (private mode, blocked site data) and the wizard must work
 * without it.
 */
export interface StoredWizard {
  v: 1;
  draft: ExperimentDraft;
  step: number;
  maxStep: number;
  dirty: boolean;
  lastUrl: string | null;
}

export function storageKey(projectId: string, experimentId: string | null): string {
  return `rl:wizard:${projectId}:${experimentId ?? "new"}`;
}

export function readStored(key: string, projectId: string): StoredWizard | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWizard;
    if (parsed?.v !== 1 || !parsed.draft || parsed.draft.projectId !== projectId) return null;
    if (!Array.isArray(parsed.draft.arms) || parsed.draft.arms.length < 2) return null;
    return parsed;
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

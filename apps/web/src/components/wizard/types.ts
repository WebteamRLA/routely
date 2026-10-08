import type { ExperimentDraft, WizardStepKey } from "@/lib/domain";
import type { UrlCheckResult } from "@/lib/view-models";

/** The project as the wizard needs it. Plain data from the page. */
export interface WizardProject {
  id: string;
  name: string;
  /** Primary domain. */
  domain: string;
  /** Primary first. */
  domains: string[];
}

/** What the page hands the wizard to start from. */
export interface WizardStart {
  mode: "new" | "edit";
  draft: ExperimentDraft;
  step: number;
  maxStep: number;
}

/** One URL check: in flight, finished (`result`), or refused (`error`, e.g. rate limited). */
export type UrlCheckEntry =
  | { pending: true }
  | { pending: false; result: UrlCheckResult; error?: undefined }
  | { pending: false; result: null; error: string };

export type ShowErr = Partial<Record<WizardStepKey, boolean>>;

export type DraftUpdater = (fn: (d: ExperimentDraft) => ExperimentDraft) => void;

/** Props every step component receives. */
export interface StepProps {
  draft: ExperimentDraft;
  update: DraftUpdater;
  /** The visible error for a field: empty until that step's errors are revealed. */
  err: (step: WizardStepKey, key: string) => string;
  showErr: ShowErr;
}

/**
 * Leave-guard contract with the app shell (agent D): while the wizard has unsaved changes it
 * sets `document.body.dataset.wizardDirty = "1"`. The shell then dispatches this event on
 * `window` instead of switching project / logging out, and the wizard calls `proceed()` once
 * the draft has been saved or discarded (or never, on Cancel).
 */
// The leave-guard contract is defined once, by the shell that dispatches it.
export { LEAVE_REQUEST_EVENT, type LeaveRequestDetail } from "@/components/layout/leave-guard";

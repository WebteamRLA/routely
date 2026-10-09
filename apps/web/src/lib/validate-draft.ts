/**
 * Wizard draft: validation (the prototype's `validate()`, messages verbatim), factories and the
 * pure draft transitions the wizard needs (add/remove arm, leaving the Setup step, loading an
 * existing experiment).
 *
 * This is the *form* rulebook: it answers "can the customer continue / launch". The server's
 * Zod schemas and services remain the authority on what is stored (same-site, conflicts,
 * locked URLs after launch).
 */

import { URL_RE, stripU } from "./domain-normalize";
import {
  MAX_ARMS,
  WIZARD_STEPS,
  armName,
  defaultTargeting,
  stepOfGroup,
  type ArmDraft,
  type DraftErrors,
  type ExperimentDraft,
  type ExperimentDraftSource,
  type ExperimentKind,
  type WizardStep,
  type WizardStepKey,
} from "./domain";
import { targetingErrors, normalizeTargeting } from "./targeting";
import { evenSplit, totalWeight } from "./traffic";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Every field error in the draft, grouped by field group then field key. Keys:
 * `basics.name|url`, `variants.v<i>` (shown on the Setup step), `traffic.sum`,
 * `targeting.pattern|devices|geo|k<i>|c<i>`, `goal.conv`. An empty object means the draft is
 * launchable as far as the form knows.
 *
 * Goal rule (design v2): every experiment, of either type, is judged on a conversion URL. It is
 * required, must be a full URL, may not be the entry URL and, for a Split URL test, may not be a
 * variant URL. A legacy draft whose goal is a metric (`event` mode) therefore needs one too — it
 * can be saved as it is, but not launched.
 */
export function validateDraft(d: ExperimentDraft): DraftErrors {
  const e: DraftErrors = {};
  const add = (step: WizardStepKey, key: string, msg: string) => {
    (e[step] ??= {})[key] = msg;
  };

  const nm = d.name.trim();
  if (!nm) add("basics", "name", "Give your experiment a name.");
  else if (nm.length < 3) add("basics", "name", "Use at least 3 characters.");

  const u = d.url.trim();
  if (!u)
    add("basics", "url", d.type === "redirect" ? "Enter the control URL." : "Enter the page URL.");
  else if (!URL_RE.test(u))
    add("basics", "url", "Use a full URL, e.g. https://example.com/landing-page");

  if (d.type === "redirect") {
    const seen: Record<string, string> = {};
    d.arms.forEach((a, i) => {
      if (!i) return;
      const v = a.url.trim();
      if (!v) add("variants", "v" + i, "Enter a URL for " + a.name + ".");
      else if (!URL_RE.test(v))
        add("variants", "v" + i, "This doesn't look like a full URL (https://…).");
      else if (stripU(v) === stripU(u))
        add("variants", "v" + i, "Must be different from the control URL.");
      else if (seen[stripU(v)]) add("variants", "v" + i, "Same URL as " + seen[stripU(v)] + ".");
      seen[stripU(v)] = a.name;
    });
  } else {
    d.arms.forEach((a, i) => {
      if (i && !a.changes.length) {
        add(
          "variants",
          "v" + i,
          a.name + " has no changes yet, so it would be identical to Control.",
        );
      }
    });
  }

  const sum = totalWeight(d.arms);
  if (sum !== 100) add("traffic", "sum", "Allocation adds up to " + sum + "%. It must equal 100%.");

  const te = targetingErrors(d.targeting);
  for (const [k, msg] of Object.entries(te)) add("targeting", k, msg);

  // Only a URL goal counts: a legacy metric goal reads as "no conversion URL yet".
  const cu = d.goalMode === "url" ? (d.convUrl || "").trim() : "";
  if (!cu) add("goal", "conv", "Enter the conversion URL: the page that counts as a conversion.");
  else if (!URL_RE.test(cu))
    add("goal", "conv", "Use a full URL, e.g. https://example.com/thank-you");
  else if (stripU(cu) === stripU(d.url)) {
    add("goal", "conv", "The conversion URL can’t be the same as the entry URL.");
  } else if (d.type === "redirect" && d.arms.slice(1).some((a) => stripU(a.url) === stripU(cu))) {
    add("goal", "conv", "The conversion URL can’t be one of the variant URLs.");
  }

  return e;
}

/** Every field group, in the order the wizard shows them. */
export const ERROR_GROUPS: readonly WizardStepKey[] = [
  "basics",
  "variants",
  "traffic",
  "targeting",
  "goal",
];

/** The field groups a step shows: Setup shows the basics and the variants. */
export function groupsOf(step: WizardStep): WizardStepKey[] {
  return step === "basics" ? ["basics", "variants"] : [step];
}

/** Index in `WIZARD_STEPS` of the step that shows a group (0 = type … 5 = review). */
export function stepIndex(key: WizardStepKey): number {
  const step = stepOfGroup(key);
  return WIZARD_STEPS.findIndex(([k]) => k === step);
}

/** Display label of the step that shows a group ("Setup", "Goals", …). */
export function stepLabel(key: WizardStepKey): string {
  const step = stepOfGroup(key);
  return WIZARD_STEPS.find(([k]) => k === step)?.[1] ?? step;
}

/** Whether there are errors at all, or in one field group. */
export function hasErrors(errors: DraftErrors, group?: WizardStepKey): boolean {
  if (group) return Object.keys(errors[group] ?? {}).length > 0;
  return ERROR_GROUPS.some((k) => Object.keys(errors[k] ?? {}).length > 0);
}

/** Whether any field group shown on a step has errors. */
export function stepHasErrors(errors: DraftErrors, step: WizardStep): boolean {
  return groupsOf(step).some((k) => hasErrors(errors, k));
}

/** The earliest step with an error, or null. */
export function firstErrorStep(errors: DraftErrors): WizardStep | null {
  const k = ERROR_GROUPS.find((g) => hasErrors(errors, g));
  return k ? stepOfGroup(k) : null;
}

/** The steps that still have errors, in order — "N steps left" on a draft. */
export function incompleteSteps(errors: DraftErrors): WizardStep[] {
  return WIZARD_STEPS.map(([k]) => k).filter((k) => k !== "review" && stepHasErrors(errors, k));
}

export interface DraftErrorItem {
  /** The field group (`variants` errors are shown on Setup). */
  step: WizardStepKey;
  /** Label of the step that shows it, e.g. "Setup". */
  stepLabel: string;
  stepIndex: number;
  key: string;
  msg: string;
}

/** Errors flattened in step order — the review screen's "issues to fix" list. */
export function errorList(errors: DraftErrors): DraftErrorItem[] {
  const out: DraftErrorItem[] = [];
  for (const k of ERROR_GROUPS) {
    for (const [key, msg] of Object.entries(errors[k] ?? {})) {
      out.push({ step: k, stepLabel: stepLabel(k), stepIndex: stepIndex(k), key, msg });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Factories and transitions
// ---------------------------------------------------------------------------

/** A blank draft as the prototype starts one: Control + Variant A at 50/50, a URL goal. */
export function newDraft(projectId: string, type: ExperimentKind): ExperimentDraft {
  return {
    id: null,
    projectId,
    type,
    name: "",
    url: "",
    hypothesis: "",
    arms: [
      { name: armName(0), url: "", weight: 50, changes: [] },
      { name: armName(1), url: "", weight: 50, changes: [] },
    ],
    coverage: 100,
    targeting: defaultTargeting(),
    goalMode: "url",
    goal: "",
    convUrl: "",
    convMatch: "exact",
    secondary: [],
    counting: "unique",
  };
}

/**
 * Switches the experiment type, as the Type step's cards do. Both types use the same URL goal
 * since design v2, so the goal is left as it is.
 */
export function setDraftType(d: ExperimentDraft, type: ExperimentKind): ExperimentDraft {
  return d.type === type ? d : { ...d, type };
}

/** Adds an arm (up to `MAX_ARMS`) and re-splits traffic evenly. Unchanged when full. */
export function addArm(d: ExperimentDraft): ExperimentDraft {
  if (d.arms.length >= MAX_ARMS) return d;
  const arms: ArmDraft[] = [
    ...d.arms,
    { name: armName(d.arms.length), url: "", weight: 0, changes: [] },
  ];
  return { ...d, arms: evenSplit(arms) };
}

/**
 * Removes arm `i` (never control, never below two arms), renames the rest by position and
 * re-splits traffic evenly.
 */
export function removeArm(d: ExperimentDraft, i: number): ExperimentDraft {
  if (i <= 0 || i >= d.arms.length || d.arms.length <= 2) return d;
  const arms = d.arms.filter((_, j) => j !== i).map((a, j) => ({ ...a, name: armName(j) }));
  return { ...d, arms: evenSplit(arms) };
}

/**
 * What the prototype does when Continue leaves the Setup step: control's arm URL follows the
 * experiment URL (Split URL), and the targeting pattern / test URL follow it too while they
 * are empty or still equal to the previous auto-filled value (`lastUrl`). Customised values
 * are left alone.
 */
export function leaveBasics(d: ExperimentDraft, lastUrl: string | null): ExperimentDraft {
  const url = d.url;
  const arms =
    d.type === "redirect" && d.arms[0] ? [{ ...d.arms[0], url }, ...d.arms.slice(1)] : d.arms;
  const prev = lastUrl ?? "";
  const t = d.targeting;
  const autoPattern =
    !t.pattern || t.pattern === prev || t.pattern === prev.replace(/\/$/, "") + "/*";
  const autoTest = !t.testUrl || t.testUrl === prev;
  return {
    ...d,
    arms,
    targeting: {
      ...t,
      pattern: autoPattern ? url : t.pattern,
      testUrl: autoTest ? url : t.testUrl,
    },
  };
}

/** Opens a stored experiment in the wizard (the prototype's `draftFrom`). */
export function draftFromExperiment(src: ExperimentDraftSource): ExperimentDraft {
  const isAb = src.type === "ab";
  const arms: ArmDraft[] = src.arms.map((a, i) => ({
    ...(i > 0 && a.id ? { id: a.id } : {}),
    name: armName(i),
    url: isAb ? "" : i === 0 ? src.url : (a.url ?? ""),
    weight: Number.isFinite(a.weight) ? a.weight : 0,
    changes: isAb && i > 0 ? (a.changes ?? []).map((c) => ({ ...c })) : [],
  }));
  // A metric goal is legacy (kept as stored); everything else is a URL goal, set or not.
  const goalMode = src.goalMetricId ? "event" : "url";
  return {
    id: src.id,
    projectId: src.projectId,
    type: src.type,
    name: src.name,
    url: src.url,
    hypothesis: src.hypothesis ?? "",
    arms,
    coverage: Math.min(100, Math.max(1, Math.round(src.coverage || 100))),
    targeting: normalizeTargeting(src.targeting, src.url),
    goalMode,
    goal: src.goalMetricId ?? "",
    convUrl: src.conversionUrl ?? "",
    convMatch: src.conversionMatch === "starts" ? "starts" : "exact",
    secondary: [...src.secondaryMetricIds],
    counting: src.counting === "all" ? "all" : "unique",
  };
}

/** A copy for "Duplicate": no id, no variant ids, name prefixed "Copy of ". */
export function duplicateDraft(d: ExperimentDraft): ExperimentDraft {
  return {
    ...d,
    id: null,
    name: "Copy of " + d.name,
    arms: d.arms.map(({ id: _id, ...a }) => ({ ...a, changes: a.changes.map((c) => ({ ...c })) })),
  };
}

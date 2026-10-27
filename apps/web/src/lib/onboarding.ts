/**
 * The Dashboard's "Getting started" checklist — the pure half (`dashboard.service` gathers the
 * facts, `components/dashboard/getting-started.tsx` renders the result).
 *
 * Add a project, install its tracking code, connect Google Sheets (optional — omitted when the
 * integration isn't configured), create an experiment. Each is read from the workspace's real
 * state, never from a "completed" flag: a step is done because the thing exists. So progress can't
 * drift from the app, a teammate's work counts for everyone, and the checklist disappears by itself
 * once the required steps are done — the first experiment exists (a draft counts), Sheets or not.
 *
 * Pure: no database.
 */

import { can } from "@/lib/permissions";
import { newExperimentHref } from "@/lib/project-dashboard";
import { type GuideAnchor, guideHref } from "@/lib/guides-types";

type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export interface ChecklistFacts {
  role: Role;
  /** Oldest first. `tracked`: the snippet was ever found (a verified check or a hit received). */
  projects: (SetupProject & { name: string; tracked: boolean })[];
  /** The workspace has at least one experiment, of any status. */
  hasExperiment: boolean;
  sheets: {
    /** The Google integration is configured on this deployment; otherwise there is no step. */
    available: boolean;
    /** Some project in the workspace has a spreadsheet attached. */
    attached: boolean;
    /** The reader chose "Skip" on this browser (`SHEETS_SKIPPED_COOKIE`). */
    skipped: boolean;
  };
}

export type StepKey = "project" | "tracking" | "sheets" | "experiment";

/** What the Dashboard's tracking dialog needs to show a project's snippet and check it. */
export interface SetupProject {
  id: string;
  domain: string;
  /** The public site id in the snippet. */
  key: string;
  protocol: "HTTPS" | "HTTP";
}

export type StepAction =
  | { kind: "link"; label: string; href: string }
  /** Opens the Dashboard's own "Add your first project" dialog. */
  | { kind: "addProject"; label: string }
  /** Opens the tracking-code dialog on the Dashboard, for this project. */
  | { kind: "pixel"; label: string; project: SetupProject }
  /** Opens the Google Sheets setup dialog on the Dashboard, for this project. */
  | { kind: "sheets"; label: string; projectId: string }
  /** Passes over an optional step (`skipSheetsStepAction`). */
  | { kind: "skip"; label: string };

export interface ChecklistStep {
  key: StepKey;
  title: string;
  /** What the step is for, or — when it can't be done yet — why. */
  text: string;
  done: boolean;
  /** Not needed to finish the checklist. */
  optional?: boolean;
  /** An optional step the reader passed over; counts as done for progress. */
  skipped?: boolean;
  /** The ways to finish it now; empty when done, blocked, or not the reader's to do. */
  actions: StepAction[];
  /** The guide section that walks through it. */
  guide: { label: string; href: string };
}

export interface Checklist {
  steps: ChecklistStep[];
  doneCount: number;
  /** The first step neither done nor skipped; null when there is none. */
  current: StepKey | null;
  /** Every required step is done. */
  complete: boolean;
  /** The project the steps act on — a tracked one, else the oldest; null with no projects. */
  homeProjectId: string | null;
}

const guide = (anchor: GuideAnchor, label = "How it works") => ({
  label,
  href: guideHref(anchor),
});

export function buildChecklist(f: ChecklistFacts): Checklist {
  const canManage = can(f.role, "project.manage");
  const canEdit = can(f.role, "experiment.edit");

  const hasProject = f.projects.length > 0;
  const untracked = f.projects.find((p) => !p.tracked);
  const tracked = f.projects.find((p) => p.tracked);
  const hasTracking = !!tracked;
  // Where a new experiment goes: a project whose tracking works, else the first one.
  const home = tracked ?? f.projects[0];

  const sheetsSettled = f.sheets.attached || f.sheets.skipped;

  const steps: ChecklistStep[] = [
    {
      key: "project",
      title: "Add your website as a project",
      text: canManage
        ? "Add the website you want to test."
        : "Ask an Owner or Admin to add your website.",
      done: hasProject,
      actions: !hasProject && canManage ? [{ kind: "addProject", label: "Add a project" }] : [],
      guide: guide("projects"),
    },
    {
      key: "tracking",
      title: "Install the tracking code",
      text: hasProject ? "Paste the tracking code into your pages." : "Add a project first.",
      done: hasTracking,
      actions:
        !hasTracking && untracked
          ? [
              {
                kind: "pixel",
                label: `Set up tracking for ${untracked.name}`,
                project: {
                  id: untracked.id,
                  domain: untracked.domain,
                  key: untracked.key,
                  protocol: untracked.protocol,
                },
              },
            ]
          : [],
      guide: guide("tracking-install"),
    },
    ...(f.sheets.available
      ? [
          {
            key: "sheets",
            title: "Connect Google Sheets",
            text: !hasProject
              ? "Optional. Add a project first."
              : canManage
                ? "Optional. Get your daily results in a spreadsheet."
                : "Optional. Ask an Owner or Admin to connect it.",
            done: f.sheets.attached,
            optional: true,
            skipped: !f.sheets.attached && f.sheets.skipped,
            actions: sheetsSettled
              ? []
              : [
                  ...(home && canManage
                    ? [
                        {
                          kind: "sheets" as const,
                          label: "Connect Google Sheets",
                          projectId: home.id,
                        },
                      ]
                    : []),
                  { kind: "skip" as const, label: "Skip" },
                ],
            guide: guide("google-sheets"),
          } satisfies ChecklistStep,
        ]
      : []),
    {
      key: "experiment",
      title: "Create your first experiment",
      text: !hasProject
        ? "Add a project first."
        : canEdit
          ? "Start an A/B or Split URL test."
          : "Viewers can’t create experiments.",
      done: f.hasExperiment,
      actions:
        !f.hasExperiment && home && canEdit
          ? [
              { kind: "link", label: "A/B test", href: newExperimentHref("ab", home.id) },
              { kind: "link", label: "Split URL test", href: newExperimentHref("split", home.id) },
            ]
          : [],
      guide: guide("choose-test", "Which test?"),
    },
  ];

  const doneCount = steps.filter((s) => s.done || s.skipped).length;
  const current = steps.find((s) => !s.done && !s.skipped)?.key ?? null;
  const complete = steps.every((s) => s.done || s.optional);
  return { steps, doneCount, current, complete, homeProjectId: home?.id ?? null };
}

/** Viewers can't act on any step, so they never get the checklist; it's gone once complete. */
export function showsChecklist(role: Role, checklist: Checklist, hidden: boolean): boolean {
  return !hidden && !checklist.complete && can(role, "experiment.edit");
}

/** Set when the reader hid the checklist on this browser (`onboarding.actions.ts`). */
export const GUIDE_HIDDEN_COOKIE = "routely-guide-hidden";

/** Set when the reader skipped the Google Sheets step on this browser. */
export const SHEETS_SKIPPED_COOKIE = "routely-sheets-skipped";

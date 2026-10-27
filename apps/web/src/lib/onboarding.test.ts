import { describe, expect, it } from "vitest";

import { type ChecklistFacts, buildChecklist, showsChecklist } from "@/lib/onboarding";

const noSheets = { available: false, attached: false, skipped: false };
const empty: ChecklistFacts = {
  role: "OWNER",
  projects: [],
  hasExperiment: false,
  sheets: noSheets,
};
const sheetsOn = (over: Partial<ChecklistFacts["sheets"]> = {}) => ({
  ...noSheets,
  available: true,
  ...over,
});
const proj = (id: string, name: string, tracked: boolean) => ({
  id,
  name,
  tracked,
  domain: `${id}.example`,
  key: `rt_${id}`,
  protocol: "HTTPS" as const,
});
const tracked = [proj("p1", "Acme", true)];

const actionsOf = (c: ReturnType<typeof buildChecklist>, key: string) =>
  c.steps.find((s) => s.key === key)!.actions;

describe("buildChecklist", () => {
  it("has three steps and starts at “add a project”, which opens the Dashboard dialog", () => {
    const c = buildChecklist(empty);
    expect(c.steps.map((s) => s.key)).toEqual(["project", "tracking", "experiment"]);
    expect(c.current).toBe("project");
    expect(c.doneCount).toBe(0);
    expect(actionsOf(c, "project")).toEqual([{ kind: "addProject", label: "Add a project" }]);
    // Later steps have nothing to do yet.
    expect(actionsOf(c, "tracking")).toEqual([]);
    expect(actionsOf(c, "experiment")).toEqual([]);
  });

  it("an Editor can't add a project and is told who can", () => {
    const c = buildChecklist({ ...empty, role: "EDITOR" });
    expect(actionsOf(c, "project")).toEqual([]);
    expect(c.steps[0]!.text).toMatch(/Ask an Owner or Admin/);
  });

  it("points tracking at the first project without it, and asks to come back", () => {
    const c = buildChecklist({
      ...empty,
      projects: [proj("p1", "Acme", false), proj("p2", "Blog", false)],
    });
    expect(c.current).toBe("tracking");
    expect(actionsOf(c, "tracking")).toEqual([
      {
        kind: "pixel",
        label: "Set up tracking for Acme",
        project: { id: "p1", domain: "p1.example", key: "rt_p1", protocol: "HTTPS" },
      },
    ]);
  });

  it("offers both test types in a tracked project", () => {
    const c = buildChecklist({
      ...empty,
      projects: [proj("p1", "Acme", false), proj("p2", "Blog", true)],
    });
    expect(c.current).toBe("experiment");
    expect(c.homeProjectId).toBe("p2");
    expect(actionsOf(c, "experiment").map((a) => a.kind === "link" && a.href)).toEqual([
      "/experiments/new/ab-test?project=p2",
      "/experiments/new/split-url?project=p2",
    ]);
  });

  it("is complete once an experiment exists, and then disappears", () => {
    const c = buildChecklist({
      ...empty,
      projects: tracked,
      hasExperiment: true,
    });
    expect(c.complete).toBe(true);
    expect(c.doneCount).toBe(3);
    expect(showsChecklist("OWNER", c, false)).toBe(false);
  });

  it("adds Google Sheets as an optional step 3 when the integration is set up", () => {
    const c = buildChecklist({ ...empty, projects: tracked, sheets: sheetsOn() });
    expect(c.steps.map((s) => s.key)).toEqual(["project", "tracking", "sheets", "experiment"]);
    expect(c.current).toBe("sheets");
    expect(actionsOf(c, "sheets")).toEqual([
      { kind: "sheets", label: "Connect Google Sheets", projectId: "p1" },
      { kind: "skip", label: "Skip" },
    ]);
  });

  it("an Editor can only skip the Sheets step", () => {
    const c = buildChecklist({ ...empty, role: "EDITOR", projects: tracked, sheets: sheetsOn() });
    expect(actionsOf(c, "sheets")).toEqual([{ kind: "skip", label: "Skip" }]);
  });

  it("a skipped Sheets step counts as progress and moves on to the experiment", () => {
    const c = buildChecklist({ ...empty, projects: tracked, sheets: sheetsOn({ skipped: true }) });
    const step = c.steps.find((s) => s.key === "sheets")!;
    expect(step.skipped).toBe(true);
    expect(step.actions).toEqual([]);
    expect(c.doneCount).toBe(3);
    expect(c.current).toBe("experiment");
  });

  it("an attached spreadsheet is done, even if it was skipped first", () => {
    const c = buildChecklist({
      ...empty,
      projects: tracked,
      sheets: sheetsOn({ attached: true, skipped: true }),
    });
    const step = c.steps.find((s) => s.key === "sheets")!;
    expect(step.done).toBe(true);
    expect(step.skipped).toBe(false);
  });

  it("the first experiment finishes the checklist even without Sheets", () => {
    const c = buildChecklist({
      ...empty,
      projects: tracked,
      hasExperiment: true,
      sheets: sheetsOn(),
    });
    expect(c.current).toBe("sheets");
    expect(c.complete).toBe(true);
    expect(showsChecklist("OWNER", c, false)).toBe(false);
  });

  it("is never shown to a Viewer, or once hidden", () => {
    const c = buildChecklist(empty);
    expect(showsChecklist("VIEWER", c, false)).toBe(false);
    expect(showsChecklist("EDITOR", c, true)).toBe(false);
    expect(showsChecklist("EDITOR", c, false)).toBe(true);
  });

  it("links every step to its guide", () => {
    for (const step of buildChecklist({ ...empty, sheets: sheetsOn() }).steps)
      expect(step.guide.href).toMatch(/^\/help#[a-z-]+$/);
  });
});

import { describe, expect, it } from "vitest";

import { isProtectedPath, routes } from "@/lib/routes";

describe("project routes", () => {
  const p = routes.project("abc");

  it("builds every page under /p/[projectId]", () => {
    expect(p.dashboard).toBe("/p/abc");
    expect(p.experiments()).toBe("/p/abc/experiments");
    expect(p.experiments({ status: "running", q: "hero page" })).toBe(
      "/p/abc/experiments?status=running&q=hero+page",
    );
    expect(p.experiment("e1")).toBe("/p/abc/experiments/e1");
    expect(p.experiment("e1", { tab: "results", range: "7", goal: undefined })).toBe(
      "/p/abc/experiments/e1?tab=results&range=7",
    );
    expect(p.newExperiment()).toBe("/p/abc/experiments/new");
    expect(p.newExperiment("ab")).toBe("/p/abc/experiments/new?type=ab");
    expect(p.editExperiment("e1")).toBe("/p/abc/experiments/e1/edit");
    expect(p.metrics()).toBe("/p/abc/metrics");
    expect(p.metrics("gtm", { metric: "m1" })).toBe("/p/abc/metrics?tab=gtm&metric=m1");
    expect(p.integrations()).toBe("/p/abc/integrations");
    expect(p.integrations("cdn")).toBe("/p/abc/integrations?tab=cdn");
    expect(p.settings()).toBe("/p/abc/settings/project");
    expect(p.settings("team")).toBe("/p/abc/settings/team");
  });

  it("encodes ids", () => {
    expect(routes.project("a/b").dashboard).toBe("/p/a%2Fb");
    expect(routes.share("t/k")).toBe("/share/t%2Fk");
  });

  it("protects the new prefixes but not /share or /login", () => {
    expect(isProtectedPath("/p/abc/experiments")).toBe(true);
    expect(isProtectedPath("/projects")).toBe(true);
    expect(isProtectedPath("/share/x")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/pricing")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { routes, withGoalEvent, wizardReturnPath } from "@/lib/routes";

describe("wizardReturnPath", () => {
  it("accepts a wizard reopening one draft", () => {
    expect(wizardReturnPath("/experiments/new/ab-test?id=cmw8riufv000g03")).toBe(
      "/experiments/new/ab-test?id=cmw8riufv000g03",
    );
    expect(wizardReturnPath("/experiments/new/split-url?id=abc_1-2")).not.toBeNull();
  });

  it("refuses anything else, including ways out of the app", () => {
    for (const bad of [
      "https://evil.test/experiments/new/ab-test?id=x",
      "//evil.test/experiments/new/ab-test?id=x",
      "javascript:alert(1)",
      "/experiments/new/ab-test",
      "/experiments/new/ab-test?id=x&next=//evil.test",
      "/experiments/new/ab-test?id=x#y",
      "/settings",
      "/experiments/new/ab-test?id=",
      undefined,
      ["/experiments/new/ab-test?id=x"],
    ]) {
      expect(wizardReturnPath(bad)).toBeNull();
    }
  });
});

describe("Metrics links", () => {
  it("carries the wizard to return to, encoded", () => {
    expect(routes.metrics.project("w1", "/experiments/new/ab-test?id=d1")).toBe(
      "/metrics?project=w1&returnTo=%2Fexperiments%2Fnew%2Fab-test%3Fid%3Dd1",
    );
    expect(routes.metrics.project("w1")).toBe("/metrics?project=w1");
  });

  it("returns with the saved event", () => {
    expect(withGoalEvent("/experiments/new/ab-test?id=d1", "ev 1")).toBe(
      "/experiments/new/ab-test?id=d1&goalEvent=ev%201",
    );
  });
});

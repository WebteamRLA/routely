import { describe, expect, it } from "vitest";

import type { ExperimentDraft, MetricSummary } from "./domain";
import { qaChecks, readiness, resolveGoal, type QaContext } from "./qa";
import { newDraft, validateDraft } from "./validate-draft";

const metric = (over: Partial<MetricSummary> = {}): MetricSummary => ({
  id: "m1",
  name: "Sign up",
  kind: "event",
  key: "signup",
  url: null,
  system: false,
  lastReceivedAt: "2026-10-08T11:00:00Z",
  count24h: 3,
  usedIn: 0,
  ...over,
});

const ctx = (over: Partial<QaContext> = {}): QaContext => ({
  trackingInstalled: true,
  projectDomains: ["acme.com"],
  metrics: [metric()],
  now: new Date("2026-10-08T12:00:00Z"),
  ...over,
});

function redirect(): ExperimentDraft {
  const d = newDraft("p", "redirect");
  return {
    ...d,
    name: "Pricing",
    url: "https://acme.com/pricing",
    arms: [
      { ...d.arms[0]!, url: "https://acme.com/pricing" },
      { ...d.arms[1]!, url: "https://acme.com/pricing-v2" },
    ],
    targeting: { ...d.targeting, pattern: "https://acme.com/pricing" },
    convUrl: "https://acme.com/thanks",
  };
}

function ab(): ExperimentDraft {
  const d = newDraft("p", "ab");
  return {
    ...d,
    name: "Hero",
    url: "https://acme.com/",
    arms: [
      d.arms[0]!,
      { ...d.arms[1]!, changes: [{ selector: "h1", prop: "text", value: "x", el: "headline" }] },
    ],
    targeting: { ...d.targeting, pattern: "https://acme.com/" },
    goal: "m1",
  };
}

const byId = (checks: ReturnType<typeof qaChecks>) =>
  Object.fromEntries(checks.map((c) => [c.id, c]));

describe("qaChecks", () => {
  it("passes a complete Split URL draft, in the prototype's order", () => {
    const checks = qaChecks(redirect(), ctx());
    expect(checks.map((c) => [c.label, c.state])).toEqual([
      ["Routely script installed", "pass"],
      ["Control URL responds", "pass"],
      ["Variant URLs respond", "pass"],
      ["Bots & crawlers excluded", "pass"],
      ["Goal is tracking", "pass"],
      ["Traffic adds up to 100%", "pass"],
      ["Targeting includes the page", "pass"],
    ]);
    const c = byId(checks);
    expect(c.script!.detail).toBe("Project snippet detected on acme.com");
    expect(c.goal!.hint).toBe("Watching for visits to /thanks");
    expect(c.traffic!.detail).toBe("50% / 50%");
    expect(c.targeting!.detail).toBe("/pricing matches your page rule");
  });

  it("passes a complete A/B draft with the A/B-specific checks", () => {
    const checks = qaChecks(ab(), ctx());
    expect(checks.map((c) => c.id)).toEqual([
      "script",
      "control",
      "changes",
      "flicker",
      "goal",
      "traffic",
      "targeting",
    ]);
    expect(checks.every((c) => c.state === "pass")).toBe(true);
    const c = byId(checks);
    expect(c.control!.label).toBe("Page loads");
    expect(c.changes!.detail).toBe("1 change will be applied by CSS selector");
    expect(c.goal!.detail).toBe("Last signup event received 1h ago");
  });

  it("fails the script check when tracking is missing or the host is foreign", () => {
    expect(byId(qaChecks(redirect(), ctx({ trackingInstalled: false }))).script).toMatchObject({
      state: "fail",
      detail:
        "Project tracking isn’t installed yet. Install it once in Settings → Installation & tracking.",
      step: "install",
    });
    expect(byId(qaChecks(redirect(), ctx({ projectDomains: ["other.com"] }))).script!.detail).toBe(
      "acme.com isn’t one of this project’s domains. Add it in Settings → Project.",
    );
    expect(byId(qaChecks({ ...redirect(), url: "" }, ctx())).script!.detail).toBe(
      "This page isn’t one of this project’s domains. Add it in Settings → Project.",
    );
  });

  it("uses real URL check results when given", () => {
    const d = redirect();
    const ok = byId(
      qaChecks(
        d,
        ctx({
          urlChecks: {
            "https://acme.com/pricing": { ok: true, status: 200 },
            "https://acme.com/pricing-v2": { ok: true },
          },
        }),
      ),
    );
    expect(ok.control!.detail).toBe("200 OK · /pricing");
    expect(ok.variants!.detail).toBe("1 of 1 reachable");
    const down = byId(
      qaChecks(
        d,
        ctx({
          urlChecks: {
            "https://acme.com/pricing": { ok: false, status: 404 },
            "https://acme.com/pricing-v2": { ok: false },
          },
        }),
      ),
    );
    expect(down.control).toMatchObject({ state: "fail", detail: "Not reachable (404) · /pricing" });
    expect(down.variants).toMatchObject({ state: "fail", detail: "1 of 1 not reachable" });
    expect(byId(qaChecks(d, ctx())).control!.detail).toBe("Valid URL · /pricing");
  });

  it("flags invalid and cross-domain variant URLs", () => {
    const d = redirect();
    d.arms = [...d.arms, { name: "Variant B", url: "nope", weight: 0, changes: [] }];
    expect(byId(qaChecks(d, ctx())).variants).toMatchObject({
      state: "fail",
      detail: "1 invalid URL",
      hint: "2 variant URLs",
    });
    d.arms[2]!.url = "https://other.io/x";
    expect(byId(qaChecks(d, ctx())).variants).toMatchObject({ state: "warn" });
    expect(
      byId(qaChecks(d, ctx({ urlChecks: { "https://other.io/x": { ok: true } } }))).variants!
        .detail,
    ).toBe("Reachable, but script missing on other.io");
  });

  it("fails A/B variants with no changes or a blank selector", () => {
    const d = ab();
    d.arms[1]!.changes = [];
    expect(byId(qaChecks(d, ctx())).changes).toMatchObject({
      state: "fail",
      detail: "Variant A has no changes",
    });
    d.arms[1]!.changes = [{ selector: " ", prop: "text", value: "x" }];
    expect(byId(qaChecks(d, ctx())).changes!.detail).toBe("1 change without a CSS selector");
  });

  it("goal: missing fails, never received warns", () => {
    expect(byId(qaChecks({ ...ab(), goal: "" }, ctx())).goal).toMatchObject({
      state: "fail",
      detail: "Choose a primary goal",
      hint: "No goal selected",
    });
    expect(
      byId(qaChecks(ab(), ctx({ metrics: [metric({ lastReceivedAt: null })] }))).goal,
    ).toMatchObject({
      state: "warn",
      detail: "No signup events received yet. Check your GTM setup.",
      hint: "Listening for signup",
    });
  });

  it("traffic and targeting", () => {
    const d = ab();
    d.arms[1]!.weight = 40;
    expect(byId(qaChecks(d, ctx())).traffic).toMatchObject({
      state: "fail",
      detail: "Currently 90%",
    });
    d.targeting.pattern = "https://acme.com/other";
    expect(byId(qaChecks(d, ctx())).targeting).toMatchObject({
      state: "warn",
      detail: "/ doesn't match the page rule",
    });
    const w = {
      ...ab(),
      url: "https://acme.com/blog/*",
      targeting: {
        ...ab().targeting,
        match: "wildcard" as const,
        pattern: "https://acme.com/blog/*",
      },
    };
    expect(byId(qaChecks(w, ctx())).targeting!.state).toBe("pass");
  });
});

describe("resolveGoal", () => {
  it("resolves URL and metric goals", () => {
    expect(resolveGoal(redirect(), [])).toMatchObject({
      isUrl: true,
      name: "Reached /thanks",
      key: "/thanks",
    });
    expect(resolveGoal({ ...redirect(), convUrl: "" }, [])).toBeUndefined();
    expect(resolveGoal(ab(), [metric()])).toMatchObject({
      isUrl: false,
      name: "Sign up",
      key: "signup",
    });
    expect(resolveGoal(ab(), [])).toBeUndefined();
  });
});

describe("readiness", () => {
  it("is checking until QA has run, then ready", () => {
    const d = redirect();
    const r0 = readiness(d, validateDraft(d), null, ctx());
    expect(r0.state).toBe("checking");
    expect(r0.canLaunch).toBe(false);
    const r = readiness(d, validateDraft(d), qaChecks(d, ctx()), ctx());
    expect(r).toMatchObject({ state: "ready", canLaunch: true, blocking: [], warnings: [] });
    expect(r.passed).toHaveLength(7);
  });

  it("collects validation errors as blocking and dedupes QA failures on the same step", () => {
    const d = { ...ab(), goal: "" };
    const r = readiness(d, validateDraft(d), qaChecks(d, ctx()), ctx());
    expect(r.blocking).toEqual([
      {
        text: "Choose the primary goal this experiment is judged on.",
        detail: "",
        step: "goal",
        stepLabel: "Goals",
        stepIndex: 5,
        action: "Fix",
      },
    ]);
    expect(r.state).toBe("blocked");
  });

  it("adds the warnings the review screen shows", () => {
    const d = { ...ab(), coverage: 50 };
    d.arms = [
      { ...d.arms[0]!, weight: 100 },
      { ...d.arms[1]!, weight: 0 },
    ];
    const c = ctx({ metrics: [metric({ lastReceivedAt: null })] });
    const r = readiness(d, validateDraft(d), qaChecks(d, c), c);
    expect(r.warnings.map((w) => w.text)).toEqual([
      "Sign up has never been received. Conversions won’t count until tracking is set up.",
      "Variant A is set to 0% and will get no traffic.",
      "Only 50% of matching visitors are included. The test will take longer to reach significance.",
    ]);
    expect(r).toMatchObject({ state: "warn", canLaunch: true });
  });

  it("counts missing tracking as a blocker without duplicating the script check", () => {
    const d = redirect();
    const c = ctx({ trackingInstalled: false });
    const r = readiness(d, validateDraft(d), qaChecks(d, c), c);
    expect(r.blocking).toEqual([]);
    expect(r).toMatchObject({
      trackingMissing: true,
      blockingCount: 1,
      state: "blocked",
      canLaunch: false,
    });
  });

  it("routes a foreign-domain script failure to installation", () => {
    const d = redirect();
    const c = ctx({ projectDomains: ["other.com"] });
    const r = readiness(d, validateDraft(d), qaChecks(d, c), c);
    expect(r.blocking[0]).toMatchObject({
      text: "Routely script installed",
      stepLabel: "Installation",
      stepIndex: -1,
      action: "Open installation",
    });
    expect(r.warnings.map((w) => w.text)).toEqual(["Variant URLs respond"]);
  });
});

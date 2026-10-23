import { describe, expect, it } from "vitest";

import type { ExperimentConfig } from "../src/contract";
import { createMemoryStore } from "../src/env";
import {
  carryParams,
  isRedirectPending,
  markLanded,
  REDIRECT_PENDING_MS,
  redirectedKey,
  decide,
  findExperimentForUrl,
  recordRedirect,
} from "../src/redirect";
import { readHandoff, stripHandoff, withHandoff } from "../src/url";

const CONTROL = "https://acme.test/pricing";
const VARIANT = "https://acme.test/pricing-v2";
const VARIANT_ID = "var_1";

const EXPERIMENT: ExperimentConfig = {
  id: "exp_1",
  control: { url: CONTROL, match: "EXACT" },
  controlWeight: 50,
  variants: [{ id: VARIANT_ID, url: VARIANT, weight: 50 }],
  goal: { url: "https://acme.test/thanks", match: "EXACT" },
  trafficAllocation: 100,
};

const always = (variantId: string | null) => () => variantId;
const ctx = (sessionStore = createMemoryStore()) => ({ visitorId: "v-123", sessionStore });

describe("matching", () => {
  it("matches the control page", () => {
    expect(findExperimentForUrl(CONTROL, [EXPERIMENT])?.id).toBe("exp_1");
  });

  it("matches despite trailing slashes, fragments and campaign parameters", () => {
    expect(findExperimentForUrl(`${CONTROL}/?utm_source=ads#plans`, [EXPERIMENT])).toBeTruthy();
  });

  it("does not match an unrelated page", () => {
    expect(findExperimentForUrl("https://acme.test/about", [EXPERIMENT])).toBeNull();
  });

  it("never matches on a variant URL", () => {
    expect(findExperimentForUrl(VARIANT, [EXPERIMENT])).toBeNull();
  });

  it("does not let a PREFIX rule capture a similarly-named page", () => {
    const prefix: ExperimentConfig = {
      ...EXPERIMENT,
      control: { url: "https://acme.test/pricing", match: "PREFIX" },
    };
    expect(findExperimentForUrl("https://acme.test/pricing-old", [prefix])).toBeNull();
    expect(findExperimentForUrl("https://acme.test/pricing/plans", [prefix])).toBeTruthy();
  });
});

describe("redirect loop prevention", () => {
  it("redirects a variant visitor away from the control page", () => {
    const decision = decide(CONTROL, [EXPERIMENT], always(VARIANT_ID), ctx());
    expect(decision?.action).toBe("redirect");
    expect(decision?.action === "redirect" && decision.target).toContain(VARIANT);
  });

  it("leaves a control visitor where they are", () => {
    expect(decide(CONTROL, [EXPERIMENT], always(null), ctx())?.action).toBe("stay");
  });

  it("does nothing on the variant page itself", () => {
    // Guard 1: a variant is never a trigger.
    expect(decide(VARIANT, [EXPERIMENT], always(VARIANT_ID), ctx())).toBeNull();
  });

  it("does not redirect again when the variant sits under a PREFIX control", () => {
    // Guard 1 in the case that actually needs it: `/pricing` with PREFIX matching also claims
    // `/pricing/v2`, so matching the control does not prove this is the control page.
    const nested: ExperimentConfig = {
      ...EXPERIMENT,
      control: { url: "https://acme.test/pricing", match: "PREFIX" },
      controlWeight: 50,
      variants: [{ id: VARIANT_ID, url: "https://acme.test/pricing/v2", weight: 50 }],
    };

    const decision = decide("https://acme.test/pricing/v2", [nested], always(VARIANT_ID), ctx());
    expect(decision?.action).toBe("skip");
    expect(decision?.action === "skip" && decision.reason).toBe("already-on-variant");
  });

  it("does not redirect a page reached by this experiment's own redirect", () => {
    // Guard 2: the handoff parameters say this page load *is* the redirect's result. Works
    // across origins, where storage from the control page is unavailable.
    const arrived = withHandoff(VARIANT, {
      visitorId: "v-123",
      experimentId: "exp_1",
      variant: VARIANT_ID,
    });

    const nested: ExperimentConfig = {
      ...EXPERIMENT,
      control: { url: "https://acme.test/pricing", match: "PREFIX" },
      controlWeight: 50,
      variants: [{ id: VARIANT_ID, url: "https://acme.test/pricing/v2", weight: 50 }],
    };
    const arrivedNested = withHandoff("https://acme.test/pricing/v2/", {
      visitorId: "v-123",
      experimentId: "exp_1",
      variant: VARIANT_ID,
    });

    expect(decide(arrived, [EXPERIMENT], always(VARIANT_ID), ctx())).toBeNull();

    const decision = decide(arrivedNested, [nested], always(VARIANT_ID), ctx());
    expect(decision?.action).toBe("skip");
  });

  it("refuses to redirect again while a redirect is still on its way (a bounce-back loop)", () => {
    // Guard 3: the variant sent the visitor straight back, so the redirect never landed.
    const session = createMemoryStore();
    recordRedirect("exp_1", session);

    const decision = decide(CONTROL, [EXPERIMENT], always(VARIANT_ID), ctx(session));
    expect(decision?.action).toBe("skip");
    expect(decision?.action === "skip" && decision.reason).toBe("already-redirected");
    expect(isRedirectPending("exp_1", session)).toBe(true);
  });

  it("redirects a returning visitor again once the earlier redirect landed", () => {
    const session = createMemoryStore();
    recordRedirect("exp_1", session);
    // The variant page loads with this experiment's handoff: the redirect landed.
    const landed = withHandoff(VARIANT, {
      visitorId: "v-123",
      experimentId: "exp_1",
      variant: VARIANT_ID,
    });
    markLanded(landed, [EXPERIMENT], session);
    expect(isRedirectPending("exp_1", session)).toBe(false);

    const decision = decide(CONTROL, [EXPERIMENT], always(VARIANT_ID), ctx(session));
    expect(decision?.action).toBe("redirect");
  });

  it("treats a pending redirect older than the window, or an old counter value, as expired", () => {
    const session = createMemoryStore();
    recordRedirect("exp_1", session, 1_000);
    expect(isRedirectPending("exp_1", session, 1_000 + REDIRECT_PENDING_MS - 1)).toBe(true);
    expect(isRedirectPending("exp_1", session, 1_000 + REDIRECT_PENDING_MS)).toBe(false);
    session.setItem(redirectedKey("exp_1"), "1"); // what the old counter stored
    expect(isRedirectPending("exp_1", session)).toBe(false);
  });

  it("only clears the marker on that experiment's own variant", () => {
    const session = createMemoryStore();
    recordRedirect("exp_1", session);
    markLanded("https://acme.test/elsewhere", [EXPERIMENT], session);
    expect(isRedirectPending("exp_1", session)).toBe(true);
    markLanded(VARIANT, [EXPERIMENT], session);
    expect(isRedirectPending("exp_1", session)).toBe(false);
  });

  it("never navigates to the page already displayed", () => {
    // Guard 4: a misconfiguration where the variant resolves to the current URL.
    const degenerate: ExperimentConfig = {
      ...EXPERIMENT,
      controlWeight: 50,
      variants: [{ id: VARIANT_ID, url: `${CONTROL}/`, weight: 50 }],
    };
    const decision = decide(CONTROL, [degenerate], always(VARIANT_ID), ctx());
    expect(decision?.action).not.toBe("redirect");
  });

  it("carries identity across the redirect and cleans it off afterwards", () => {
    const decision = decide(CONTROL, [EXPERIMENT], always(VARIANT_ID), ctx());
    const target = decision?.action === "redirect" ? decision.target : "";

    expect(readHandoff(target)).toEqual({
      visitorId: "v-123",
      experimentId: "exp_1",
      variant: VARIANT_ID,
    });
    expect(stripHandoff(target)).toBe(`${VARIANT}`);
  });

  it("treats a variant id absent from this experiment's own list as control", () => {
    // Defensive: a stale/corrupted assignment referencing a variant that no longer exists must
    // never redirect to an undefined target.
    const decision = decide(CONTROL, [EXPERIMENT], always("not-a-real-variant"), ctx());
    expect(decision).toEqual({ action: "stay", experiment: EXPERIMENT, variantId: null });
  });
});

describe("experiment status", () => {
  it("does nothing for a paused experiment", () => {
    // A paused experiment is absent from the configuration the endpoint publishes, so the SDK
    // sees an empty list. There is no client-side "is this paused?" check to get wrong.
    expect(decide(CONTROL, [], always(VARIANT_ID), ctx())).toBeNull();
  });

  it("does nothing for a draft experiment", () => {
    // Same mechanism: a draft is never published, so it cannot affect a visitor.
    expect(decide(CONTROL, [], always(VARIANT_ID), ctx())).toBeNull();
  });

  it("only acts on the experiments it was given", () => {
    const other: ExperimentConfig = {
      ...EXPERIMENT,
      id: "exp_other",
      control: { url: "https://acme.test/other", match: "EXACT" },
    };
    expect(decide(CONTROL, [other], always(VARIANT_ID), ctx())).toBeNull();
  });
});

describe("traffic allocation", () => {
  it("skips a visitor `includedFor` excludes, without drawing an arm", () => {
    let variantDrawn = false;
    const variantFor = () => {
      variantDrawn = true;
      return VARIANT_ID;
    };

    const decision = decide(CONTROL, [EXPERIMENT], variantFor, ctx(), () => false);

    expect(decision).toEqual({ action: "skip", experiment: EXPERIMENT, reason: "excluded" });
    // The whole point: an excluded visitor never reaches the point of being assigned an arm.
    expect(variantDrawn).toBe(false);
  });

  it("defaults to including everyone when no `includedFor` is given", () => {
    // Every existing call site (and every test above) omits the fifth argument — this is what
    // keeps them all behaving exactly as before.
    expect(decide(CONTROL, [EXPERIMENT], always(null), ctx())?.action).toBe("stay");
  });

  it("is checked before the redirect-loop guards", () => {
    // An excluded visitor is skipped even on a page load that would otherwise redirect.
    const decision = decide(CONTROL, [EXPERIMENT], always(VARIANT_ID), ctx(), () => false);
    expect(decision?.action).toBe("skip");
    expect(decision?.action === "skip" && decision.reason).toBe("excluded");
  });

  it("includes a visitor `includedFor` approves", () => {
    const decision = decide(CONTROL, [EXPERIMENT], always(VARIANT_ID), ctx(), () => true);
    expect(decision?.action).toBe("redirect");
  });
});

describe("keepParams", () => {
  const KEEP: ExperimentConfig = { ...EXPERIMENT, keepParams: true };

  it("carries campaign parameters and the fragment from an EXACT control", () => {
    // Under EXACT matching only parameters normalisation ignores (utm_*, gclid, …) can be on
    // the control page at all; any other parameter makes it a different page.
    const decision = decide(
      `${CONTROL}?utm_source=ads&gclid=g1#faq`,
      [KEEP],
      always(VARIANT_ID),
      ctx(),
    );
    expect(decision?.action).toBe("redirect");
    const target = new URL(decision?.action === "redirect" ? decision.target : "");
    expect(target.searchParams.get("utm_source")).toBe("ads");
    expect(target.searchParams.get("gclid")).toBe("g1");
    expect(target.searchParams.get("_rt_v")).toBe(VARIANT_ID);
    expect(target.hash).toBe("#faq");
  });

  it("carries any parameter from a PREFIX control", () => {
    const prefix: ExperimentConfig = { ...KEEP, control: { url: CONTROL, match: "PREFIX" } };
    const decision = decide(`${CONTROL}?plan=pro`, [prefix], always(VARIANT_ID), ctx());
    const target = new URL(decision?.action === "redirect" ? decision.target : "");
    expect(target.searchParams.get("plan")).toBe("pro");
  });

  it("drops them without keepParams, as before", () => {
    const decision = decide(`${CONTROL}?utm_source=ads`, [EXPERIMENT], always(VARIANT_ID), ctx());
    const target = new URL(decision?.action === "redirect" ? decision.target : "");
    expect(target.searchParams.get("utm_source")).toBeNull();
  });

  it("lets the variant's own parameters win, and never carries handoff parameters", () => {
    expect(carryParams("https://acme.test/v2?plan=basic", "https://acme.test/p?plan=pro&x=1")).toBe(
      "https://acme.test/v2?plan=basic&x=1",
    );
    expect(
      carryParams("https://acme.test/v2", "https://acme.test/p?_rt_vid=abc&_rt_e=e&_rt_v=v"),
    ).toBe("https://acme.test/v2");
    expect(carryParams("https://acme.test/v2#top", "https://acme.test/p#faq")).toBe(
      "https://acme.test/v2#top",
    );
  });

  it("returns the target unchanged when either URL does not parse", () => {
    expect(carryParams("not a url", CONTROL)).toBe("not a url");
    expect(carryParams(VARIANT, "not a url")).toBe(VARIANT);
  });

  it("recognises a variant nested under a PREFIX control with carried parameters", () => {
    const nested: ExperimentConfig = {
      ...KEEP,
      control: { url: CONTROL, match: "PREFIX" },
      variants: [{ id: VARIANT_ID, url: `${CONTROL}/v2`, weight: 50 }],
    };
    const decision = decide(`${CONTROL}/v2?plan=pro`, [nested], always(VARIANT_ID), ctx());
    expect(decision).toMatchObject({ action: "skip", reason: "already-on-variant" });
  });
});

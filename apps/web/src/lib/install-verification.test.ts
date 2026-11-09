import { describe, expect, it } from "vitest";

import {
  SIGNAL_GRACE_MS,
  type StaticLook,
  VERIFY_WINDOW_MS,
  type VerifyObservation,
  readServerCheck,
  readVerification,
} from "@/lib/install-verification";

const AT = new Date("2026-11-05T10:00:00Z");

const LOOK: StaticLook = {
  pageLoaded: true,
  loadError: null,
  inHtml: false,
  otherInHtml: false,
  containers: [],
  inContainer: false,
  otherInContainer: false,
  containerUnreadable: false,
};

function read(over: Partial<VerifyObservation> = {}, look: Partial<StaticLook> = {}) {
  return readVerification({
    method: "GTM",
    look: { ...LOOK, ...look },
    loadedAt: null,
    readyAt: null,
    failReason: null,
    otherSiteIds: [],
    tagCount: null,
    browser: null,
    elapsedMs: 0,
    ...over,
  });
}

const late = { elapsedMs: VERIFY_WINDOW_MS };

describe("readVerification", () => {
  it("verifies only on the backend signal", () => {
    expect(read({ readyAt: AT, loadedAt: AT }).status).toBe("verified");
    expect(read({ readyAt: AT }).final).toBe(true);
  });

  it("does not verify on a tag in the page, GTM, or a page that loaded", () => {
    expect(read(late, { inHtml: true }).status).not.toBe("verified");
    expect(read(late, { inContainer: true, containers: ["GTM-A"] }).status).not.toBe("verified");
    expect(read(late, { containers: ["GTM-A"] }).status).not.toBe("verified");
    expect(read(late).status).not.toBe("verified");
  });

  it("never verifies on the browser's word alone", () => {
    expect(read({ ...late, browser: { stage: "ready" } }).status).toBe("backend_signal_missing");
  });

  it("waits while nothing has been seen, without a false failure", () => {
    const early = read({ elapsedMs: VERIFY_WINDOW_MS - 1 });
    expect(early.status).toBe("waiting");
    expect(early.final).toBe(false);
  });

  it("is in progress once there is something to wait for", () => {
    expect(read({ elapsedMs: 1000 }, { inContainer: true }).status).toBe("in_progress");
    expect(read({ elapsedMs: 1000, loadedAt: AT }).status).toBe("in_progress");
    expect(read({ elapsedMs: 1000, browser: { stage: "loaded" } }).status).toBe("in_progress");
  });

  it("always ends: every silent check is final at the window", () => {
    for (const look of [{}, { inHtml: true }, { containers: ["GTM-A"] }, { pageLoaded: false }]) {
      expect(read(late, look).final).toBe(true);
    }
  });

  it("names the wrong project from the SDK itself", () => {
    const result = read({ otherSiteIds: ["rt_other"] });
    expect(result.status).toBe("wrong_site_id");
    expect(result.final).toBe(true);
  });

  it("names the wrong project from the HTML or the container", () => {
    expect(read(late, { otherInHtml: true }).status).toBe("wrong_site_id");
    expect(read(late, { otherInContainer: true }).status).toBe("wrong_site_id");
  });

  it("warns about, rather than fails on, a second tag or another project beside this one", () => {
    expect(read({ readyAt: AT, tagCount: 2 }).warnings[0]).toContain("more than once");
    const both = read({ readyAt: AT, loadedAt: AT, otherSiteIds: ["rt_other"] });
    expect(both.status).toBe("verified");
    expect(both.warnings[0]).toContain("Another project");
  });

  it("separates a tag that never ran from one that ran and stalled", () => {
    expect(read(late, { inHtml: true }).status).toBe("sdk_failed_to_load");
    expect(read(late, { inContainer: true }).status).toBe("sdk_failed_to_load");
    expect(read({ ...late, loadedAt: AT }).status).toBe("sdk_not_initialized");
  });

  it("reports a configuration failure and a tag with no id at once", () => {
    expect(read({ failReason: "config", loadedAt: AT }).status).toBe("sdk_not_initialized");
    expect(read({ failReason: "no_site_id" }).status).toBe("sdk_not_initialized");
  });

  it("gives the backend signal time to land before saying it is missing", () => {
    const browser = { stage: "ready" } as const;
    expect(read({ browser, elapsedMs: SIGNAL_GRACE_MS - 1 }).status).toBe("in_progress");
    expect(read({ browser, elapsedMs: SIGNAL_GRACE_MS }).status).toBe("backend_signal_missing");
  });

  it("tells an unpublished GTM tag from a site with no GTM", () => {
    const unpublished = read(late, { containers: ["GTM-A"] });
    expect(unpublished.status).toBe("not_installed");
    expect(unpublished.detail).toContain("published");
    expect(read(late).detail).toContain("wasn’t found");
  });

  it("gives manual installs their own words", () => {
    expect(read({ ...late, method: "MANUAL" }).steps.join(" ")).not.toContain("Tag Manager");
  });

  it("fails with the reason when the page would not load", () => {
    const result = read(late, { pageLoaded: false, loadError: "HTTP 503" });
    expect(result.status).toBe("failed");
    expect(result.detail).toBe("HTTP 503");
  });

  it("has guidance for every failure", () => {
    const failures = [
      read(late),
      read(late, { inHtml: true }),
      read({ otherSiteIds: ["rt_o"] }),
      read({ failReason: "config" }),
      read({ ...late, browser: { stage: "ready" } }),
      read(late, { pageLoaded: false }),
    ];
    for (const failure of failures) expect(failure.steps.length).toBeGreaterThan(0);
  });
});

describe("readServerCheck", () => {
  // The anti-flicker block in place, so these cases are about the tag alone.
  const check = (method: "GTM" | "MANUAL", look: Partial<StaticLook> = {}) =>
    readServerCheck(method, { ...LOOK, antiFlicker: "ok", ...look });

  it("verifies on this project's code in the page or in a published container", () => {
    expect(check("MANUAL", { inHtml: true }).status).toBe("verified");
    expect(check("GTM", { inHtml: true }).status).toBe("verified");
    expect(check("GTM", { containers: ["GTM-A"], inContainer: true }).status).toBe("verified");
    expect(check("MANUAL", { containers: ["GTM-A"], inContainer: true }).status).toBe("verified");
  });

  it("is always final, so the dialog never waits", () => {
    expect(check("GTM").final).toBe(true);
    expect(check("MANUAL", { inHtml: true }).final).toBe(true);
  });

  it("does not verify a page that failed to load, even with the code in an old copy", () => {
    const res = check("MANUAL", { pageLoaded: false, loadError: "Timed out.", inHtml: true });
    expect(res.status).toBe("failed");
    expect(res.detail).toBe("Timed out.");
  });

  it("names another project's code, and says where it is", () => {
    expect(check("MANUAL", { otherInHtml: true }).status).toBe("wrong_site_id");
    const gtm = check("GTM", { containers: ["GTM-A"], otherInContainer: true });
    expect(gtm.status).toBe("wrong_site_id");
    expect(gtm.detail).toMatch(/Tag Manager/);
  });

  it("points at publishing when the container is on the page without the tag", () => {
    const res = check("GTM", { containers: ["GTM-A"] });
    expect(res.status).toBe("not_installed");
    expect(res.detail).toContain("GTM-A");
    expect(res.steps.join(" ")).toMatch(/Publish/);
  });

  it("says when Tag Manager isn't on the page at all", () => {
    expect(check("GTM").detail).toMatch(/wasn’t found/);
    expect(check("MANUAL").detail).toMatch(/wasn’t in it/);
  });
});

describe("readServerCheck: the anti-flicker block on a Tag Manager install", () => {
  const published = { ...LOOK, containers: ["GTM-A"], inContainer: true };

  it("verifies only with the block in <head> above Tag Manager", () => {
    expect(readServerCheck("GTM", { ...published, antiFlicker: "ok" }).status).toBe("verified");
    for (const antiFlicker of ["missing", "below_gtm", "outside_head"] as const) {
      const res = readServerCheck("GTM", { ...published, antiFlicker });
      expect(res.status).toBe("anti_flicker");
      expect(res.final).toBe(true);
    }
  });

  it("says what is wrong with the block", () => {
    expect(readServerCheck("GTM", { ...published, antiFlicker: "missing" }).title).toBe(
      "Anti-flicker block not found",
    );
    expect(readServerCheck("GTM", { ...published, antiFlicker: "below_gtm" }).steps[0]).toMatch(
      /above the Google Tag Manager snippet/,
    );
    expect(readServerCheck("GTM", { ...published, antiFlicker: "outside_head" }).detail).toMatch(
      /<body>/,
    );
  });

  it("treats a look stored without the field as missing the block", () => {
    expect(readServerCheck("GTM", published).status).toBe("anti_flicker");
  });

  it("names both problems when the tag is unpublished too, the tag first", () => {
    const res = readServerCheck("GTM", { ...LOOK, containers: ["GTM-A"], antiFlicker: "missing" });
    expect(res.status).toBe("not_installed");
    expect(res.detail).toMatch(/published version.*anti-flicker block isn’t/);
    expect(res.steps[0]).toMatch(/Submit, then Publish/);
    expect(
      res.steps.some((step) => /Tag Manager code\. It includes the anti-flicker/.test(step)),
    ).toBe(true);
  });

  it("accepts the block inside the published tag, with a note about the flash", () => {
    const res = readServerCheck("GTM", {
      ...published,
      antiFlicker: "missing",
      antiFlickerInContainer: true,
    });
    expect(res.status).toBe("verified");
    expect(res.warnings.join(" ")).toMatch(/inside Google Tag Manager.*<head>/);
  });

  it("adds no note when the block is in <head> as well", () => {
    const res = readServerCheck("GTM", {
      ...published,
      antiFlicker: "ok",
      antiFlickerInContainer: true,
    });
    expect(res.status).toBe("verified");
    expect(res.warnings).toEqual([]);
  });

  it("does not let the block in the container stand in for an unpublished tag", () => {
    const res = readServerCheck("GTM", {
      ...LOOK,
      containers: ["GTM-A"],
      antiFlicker: "missing",
      antiFlickerInContainer: true,
    });
    expect(res.status).toBe("not_installed");
  });

  it("leaves a page that didn't load, and a manual install, as they were", () => {
    expect(
      readServerCheck("GTM", { ...LOOK, pageLoaded: false, antiFlicker: "missing" }).status,
    ).toBe("failed");
    expect(
      readServerCheck("MANUAL", { ...LOOK, inHtml: true, antiFlicker: "missing" }).status,
    ).toBe("verified");
  });
});

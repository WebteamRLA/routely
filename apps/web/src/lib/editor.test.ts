import { describe, expect, it } from "vitest";

import type { Change } from "./domain";
import {
  DEFAULT_SELECTORS,
  PAGE,
  changeCount,
  changeLabel,
  pageVals,
  removeChange,
  resetElement,
  selectorFor,
  setElementSelector,
  upsertChange,
} from "./editor";

describe("pageVals", () => {
  it("shows originals with no changes", () => {
    expect(pageVals(null)).toEqual({
      eyebrow: PAGE.eyebrow.orig,
      headline: PAGE.headline.orig,
      sub: PAGE.sub.orig,
      cta: PAGE.cta.orig,
      ctaBg: "#0F1B35",
      image: PAGE.image.orig,
      trust: PAGE.trust.orig,
    });
  });

  it("applies changes by element and property", () => {
    const v = pageVals([
      { selector: "h1", prop: "text", value: "Ship 2× faster", el: "headline" },
      { selector: "a", prop: "bg", value: "#F0603F", el: "cta" },
    ]);
    expect(v.headline).toBe("Ship 2× faster");
    expect(v.ctaBg).toBe("#F0603F");
    expect(v.cta).toBe(PAGE.cta.orig);
  });
});

describe("changeLabel", () => {
  it("labels as the prototype does, falling back to the selector", () => {
    expect(changeLabel({ el: "headline", prop: "text", selector: "h1" })).toBe(
      "Headline (H1) · text",
    );
    expect(changeLabel({ el: "cta", prop: "bg", selector: "a" })).toBe("Primary button · color");
    expect(changeLabel({ el: "image", prop: "image", selector: "img" })).toBe("Hero image · image");
    expect(changeLabel({ prop: "text", selector: ".promo" })).toBe(".promo · text");
  });
});

describe("change editing", () => {
  it("adds with the default selector, updates in place, removes when set back to the original", () => {
    let c: Change[] = [];
    c = upsertChange(c, "headline", "text", "New");
    expect(c).toEqual([
      { selector: DEFAULT_SELECTORS.headline, prop: "text", value: "New", el: "headline" },
    ]);
    c = setElementSelector(c, "headline", "#hero h1");
    c = upsertChange(c, "headline", "text", "Newer");
    expect(c).toEqual([{ selector: "#hero h1", prop: "text", value: "Newer", el: "headline" }]);
    c = upsertChange(c, "headline", "text", PAGE.headline.orig);
    expect(c).toEqual([]);
  });

  it("reuses an element's custom selector for a new property", () => {
    let c = upsertChange([], "cta", "text", "Go", ".buy");
    c = upsertChange(c, "cta", "bg", "#2B59F0");
    expect(c.map((x) => x.selector)).toEqual([".buy", ".buy"]);
    expect(upsertChange(c, "cta", "bg", "#0F1B35")).toHaveLength(1);
    expect(selectorFor(c, "cta")).toBe(".buy");
    expect(selectorFor(c, "trust")).toBe(DEFAULT_SELECTORS.trust);
  });

  it("removes and resets without mutating", () => {
    const c = upsertChange(upsertChange([], "cta", "text", "Go"), "sub", "text", "S");
    expect(removeChange(c, 0).map((x) => x.el)).toEqual(["sub"]);
    expect(resetElement(c, "sub").map((x) => x.el)).toEqual(["cta"]);
    expect(c).toHaveLength(2);
    expect(changeCount(1)).toBe("1 change");
    expect(changeCount(3)).toBe("3 changes");
  });
});

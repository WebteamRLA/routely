import { describe, expect, it } from "vitest";

import { newDraft } from "@/lib/validate-draft";

import { parseStored } from "./draft-storage";

const draft = newDraft("p1", "ab");
const stored = (over: Record<string, unknown>) => ({
  v: 2,
  draft,
  step: 2,
  maxStep: 3,
  dirty: true,
  lastUrl: null,
  ...over,
});

describe("parseStored", () => {
  it("keeps a six-step copy as it is", () => {
    expect(parseStored(stored({}), "p1")).toMatchObject({ v: 2, step: 2, maxStep: 3 });
  });

  it("moves a seven-step copy onto six steps: Variants opens Setup", () => {
    const at = (step: number, maxStep = step) => parseStored(stored({ v: 1, step, maxStep }), "p1");
    expect(at(0)).toMatchObject({ step: 0, maxStep: 0 });
    expect(at(1)).toMatchObject({ step: 1 });
    expect(at(2, 6)).toMatchObject({ step: 1, maxStep: 5 }); // Variants → Setup; Review → Review
    expect(at(3)).toMatchObject({ step: 2 }); // Traffic
    expect(at(5)).toMatchObject({ step: 4 }); // Goals
  });

  it("refuses another project's copy, an unknown version or a broken draft", () => {
    expect(parseStored(stored({}), "p2")).toBeNull();
    expect(parseStored(stored({ v: 3 }), "p1")).toBeNull();
    expect(parseStored(stored({ draft: { ...draft, arms: [] } }), "p1")).toBeNull();
    expect(parseStored(null, "p1")).toBeNull();
  });
});

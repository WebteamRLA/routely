import { describe, expect, it } from "vitest";

import {
  changeSchema,
  editLiveExperimentSchema,
  endExperimentSchema,
  experimentDraftSchema,
} from "@/validation/experiment";

const baseDraft = {
  projectId: "p1",
  type: "redirect",
  arms: [
    { name: "Control", url: "", weight: 50, changes: [] },
    { name: "Variant A", url: "", weight: 50, changes: [] },
  ],
  targeting: null,
};

describe("experimentDraftSchema", () => {
  it("accepts an empty draft and fills defaults", () => {
    const parsed = experimentDraftSchema.parse(baseDraft);
    expect(parsed.name).toBe("");
    expect(parsed.coverage).toBe(100);
    expect(parsed.counting).toBe("unique");
    expect(parsed.goalMode).toBe("url");
  });

  it("caps arms at five", () => {
    const arms = Array.from({ length: 6 }, () => ({ url: "", weight: 0, changes: [] }));
    const parsed = experimentDraftSchema.safeParse({ ...baseDraft, arms });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/at most 5 arms/);
  });

  it("bounds weights and coverage", () => {
    expect(
      experimentDraftSchema.safeParse({
        ...baseDraft,
        arms: [{ url: "", weight: 101, changes: [] }],
      }).success,
    ).toBe(false);
    expect(experimentDraftSchema.safeParse({ ...baseDraft, coverage: 0 }).success).toBe(false);
  });

  it("rejects ids that are not ids", () => {
    expect(experimentDraftSchema.safeParse({ ...baseDraft, id: "../etc" }).success).toBe(false);
    expect(experimentDraftSchema.safeParse({ ...baseDraft, secondary: ["a b"] }).success).toBe(
      false,
    );
  });
});

describe("changeSchema", () => {
  it("accepts text, colour and image changes", () => {
    expect(
      changeSchema.safeParse({ selector: "h1", prop: "text", value: "<b>hi</b>" }).success,
    ).toBe(true);
    expect(changeSchema.safeParse({ selector: ".cta", prop: "bg", value: "#F0603F" }).success).toBe(
      true,
    );
    expect(
      changeSchema.safeParse({ selector: ".cta", prop: "bg", value: "rgb(1, 2, 3)" }).success,
    ).toBe(true);
    expect(
      changeSchema.safeParse({
        selector: "img",
        prop: "image",
        value: "https://cdn.acme.com/a.png",
      }).success,
    ).toBe(true);
    expect(
      changeSchema.safeParse({ selector: "img", prop: "image", value: "/a.png" }).success,
    ).toBe(true);
  });

  it("refuses CSS that could break out of a colour, and script URLs", () => {
    expect(
      changeSchema.safeParse({ selector: ".cta", prop: "bg", value: "red;}body{display:none" })
        .success,
    ).toBe(false);
    expect(
      changeSchema.safeParse({ selector: "img", prop: "image", value: "javascript:alert(1)" })
        .success,
    ).toBe(false);
    expect(
      changeSchema.safeParse({ selector: "img", prop: "image", value: "//evil.com/a.png" }).success,
    ).toBe(false);
  });

  it("requires a selector", () => {
    const parsed = changeSchema.safeParse({ selector: " ", prop: "text", value: "x" });
    expect(parsed.error?.issues[0]?.message).toBe("Choose the element to change.");
  });
});

describe("endExperimentSchema / editLiveExperimentSchema", () => {
  it("accepts a null winner and positions 0–4", () => {
    expect(
      endExperimentSchema.parse({ projectId: "p", experimentId: "e", winnerPosition: null })
        .keepWinner,
    ).toBe(false);
    expect(
      endExperimentSchema.safeParse({ projectId: "p", experimentId: "e", winnerPosition: 5 })
        .success,
    ).toBe(false);
  });

  it("keeps post-launch edits bounded", () => {
    expect(
      editLiveExperimentSchema.safeParse({ projectId: "p", experimentId: "e", name: "ab" }).success,
    ).toBe(false);
    expect(
      editLiveExperimentSchema.safeParse({ projectId: "p", experimentId: "e", weights: [100] })
        .success,
    ).toBe(false);
  });
});

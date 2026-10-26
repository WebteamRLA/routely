import { describe, expect, it } from "vitest";

import {
  changeCountOf,
  draftPatch,
  emptyForm,
  formFromDraft,
  sampleForm,
} from "@/lib/mock/ab-test";
import {
  draftPatchSchema,
  pausedEditSchema,
  PAUSED_EDIT_LOCKED_MESSAGE,
} from "@/validation/experiment";
import {
  readStoredChanges,
  toStoredChanges,
  visualChangeSchema,
  visualChangesSchema,
} from "@/validation/visual-change";

const base = {
  id: "c1",
  selector: "#hero h1",
  kind: "heading" as const,
  label: "Heading · Gear up for fall",
  fingerprint: { tag: "h1" },
  original: { text: "Gear up for fall" },
  set: { text: "Fall sale" },
};

describe("visualChangeSchema", () => {
  it("accepts a valid change", () => {
    expect(visualChangeSchema.safeParse(base).success).toBe(true);
  });

  it("refuses unsafe or empty values", () => {
    const bad = [
      { ...base, set: {} },
      { ...base, set: { text: "Gear up for fall" } },
      { ...base, set: { backgroundColor: "red; background: url(x)" } },
      { ...base, set: { src: "javascript:alert(1)" } },
      { ...base, set: { src: "http://acme.com/a.png" } },
      { ...base, set: { text: "x".repeat(2001) } },
      { ...base, set: { alt: "x".repeat(501) } },
      { ...base, set: { html: "<b>x</b>" } },
      { ...base, kind: "video" },
    ];
    for (const change of bad) expect(visualChangeSchema.safeParse(change).success).toBe(false);
  });

  it("accepts the colours the SDK accepts", () => {
    for (const color of ["#fff", "#1F3D2B", "rgb(1, 2, 3)", "rgba(1,2,3,0.5)"]) {
      expect(
        visualChangeSchema.safeParse({ ...base, set: { backgroundColor: color } }).success,
      ).toBe(true);
    }
  });

  it("caps a variant at 50 changes with unique ids", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...base, id: `c${i}` }));
    expect(visualChangesSchema.safeParse(many).success).toBe(false);
    expect(visualChangesSchema.safeParse([base, base]).success).toBe(false);
  });

  it("reads the envelope or a bare array, dropping anything invalid", () => {
    expect(readStoredChanges(toStoredChanges([base]))).toEqual([base]);
    expect(readStoredChanges([base, { nope: true }])).toEqual([base]);
    expect(readStoredChanges(null)).toEqual([]);
  });
});

describe("the A/B wizard's editor changes", () => {
  it("send a live variant's stored changes in the autosave patch, verbatim", () => {
    const form = sampleForm();
    form.variants[0] = { ...form.variants[0]!, visual: [base] };
    const patch = draftPatch(form, 3, (key) => (key === "v1" ? "stored-v1" : undefined));
    const parsed = draftPatchSchema.safeParse(patch);
    expect(parsed.success).toBe(true);
    expect(patch.variants[0]).toMatchObject({ id: "stored-v1", key: "v1", changes: [base] });
    // The mock storefront's overrides never reach the server.
    expect(patch.variants[1]).not.toHaveProperty("id");
    expect(patch.variants[1]!.changes).toEqual([]);
    expect(draftPatchSchema.safeParse(draftPatch(emptyForm(), 1, () => undefined)).success).toBe(
      true,
    );
  });

  it("reopen from a stored draft with every stored change", () => {
    const form = formFromDraft({
      name: "Hero",
      controlUrl: "https://acme.com/",
      conversionUrl: null,
      trafficAllocation: 60,
      controlWeight: 34,
      targetDevices: ["DESKTOP", "MOBILE"],
      variants: [{ id: "x1", name: "Variant A", weight: 66, colorIndex: 1, changes: [base] }],
    });
    expect(form).toMatchObject({
      pageUrl: "https://acme.com/",
      goalUrl: "",
      include: "60",
      split: { control: "34", x1: "66" },
      targeting: "specific",
      devices: { desktop: true, mobile: true, tablet: false },
    });
    expect(form.variants[0]!.visual).toEqual([base]);
    expect(form.variants[0]!.changes).toEqual({});
    expect(changeCountOf(form.variants[0]!)).toBe(1);
  });
});

describe("draft and paused-edit schemas", () => {
  it("stores a draft leniently but caps it", () => {
    expect(draftPatchSchema.safeParse({ name: "", controlUrl: "half typ" }).success).toBe(true);
    expect(draftPatchSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
    expect(draftPatchSchema.safeParse({ controlUrl: "x".repeat(2049) }).success).toBe(false);
    const five = Array.from({ length: 5 }, (_, i) => ({ key: `v${i}`, name: "V", weight: 20 }));
    expect(draftPatchSchema.safeParse({ variants: five }).success).toBe(false);
    expect(draftPatchSchema.safeParse({ status: "ACTIVE" }).success).toBe(false);
  });

  it("allows only the name and traffic while paused (D7)", () => {
    expect(pausedEditSchema.safeParse({ name: "New", trafficAllocation: 40 }).success).toBe(true);
    const locked = pausedEditSchema.safeParse({ controlUrl: "https://acme.com/x" });
    expect(locked.success).toBe(false);
    expect(locked.error?.issues[0]?.message).toBe(PAUSED_EDIT_LOCKED_MESSAGE);
    expect(pausedEditSchema.safeParse({ trafficAllocation: 0 }).success).toBe(false);
  });
});

describe("visualChangeSchema — blocks, styles and hiding", () => {
  const block = {
    id: "c9",
    selector: "body > section:nth-of-type(1)",
    kind: "block" as const,
    label: "Section",
    fingerprint: { tag: "section" },
    original: { backgroundColor: "rgb(19, 33, 61)", color: "rgb(255, 255, 255)", padding: "0px" },
  };

  it("accepts a section restyled and a block hidden", () => {
    const styled = {
      ...block,
      set: {
        backgroundColor: "#1F3D2B",
        color: "#FFFFFF",
        fontSize: "1.5rem",
        fontWeight: "700",
        textAlign: "center",
        padding: "48px 24px",
        margin: "0 auto",
      },
    };
    expect(visualChangeSchema.safeParse(styled).success).toBe(true);
    expect(visualChangeSchema.safeParse({ ...block, set: { hidden: true } }).success).toBe(true);
  });

  it("refuses style values the editor would never produce", () => {
    for (const set of [
      { fontSize: "12px; background:url(x)" },
      { fontSize: "-4px" },
      { fontWeight: "750" },
      { textAlign: "middle" },
      { padding: "1px 2px 3px 4px 5px" },
      { padding: "-8px" },
      { margin: "calc(1px + 2px)" },
      { color: "red" },
      { hidden: false },
    ]) {
      expect(visualChangeSchema.safeParse({ ...block, set }).success, JSON.stringify(set)).toBe(
        false,
      );
    }
    // A negative margin is a real layout tool; a negative padding is not valid CSS.
    expect(visualChangeSchema.safeParse({ ...block, set: { margin: "-8px 0" } }).success).toBe(
      true,
    );
  });

  it("still refuses a style change equal to the original", () => {
    expect(
      visualChangeSchema.safeParse({ ...block, set: { color: "rgb(255, 255, 255)" } }).success,
    ).toBe(false);
  });
});

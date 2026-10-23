import { describe, expect, it } from "vitest";

import { changeSummaries, describeChange, readStoredChanges } from "@/lib/change-summary";

describe("readStoredChanges", () => {
  it("reads a bare list and an envelope alike", () => {
    const change = { selector: "#h", kind: "heading", set: { text: "Hi" } };
    expect(readStoredChanges([change])).toEqual([{ kind: "heading", set: { text: "Hi" } }]);
    expect(readStoredChanges({ schemaVersion: 1, changes: [change] })).toHaveLength(1);
  });

  it("skips malformed items without dropping the rest", () => {
    const stored = [
      null,
      { kind: "video", set: { text: "x" } },
      { kind: "text", set: {} },
      { kind: "text", set: { text: 4 } },
      { kind: "button", label: " Hero button ", set: { text: "Go" } },
    ];
    expect(readStoredChanges(stored)).toEqual([
      { kind: "button", label: "Hero button", set: { text: "Go" } },
    ]);
  });

  it("treats anything else as no changes", () => {
    expect(readStoredChanges(null)).toEqual([]);
    expect(readStoredChanges("nope")).toEqual([]);
    expect(readStoredChanges({ changes: "nope" })).toEqual([]);
  });
});

describe("describeChange", () => {
  it("uses the editor's label when there is one", () => {
    expect(describeChange({ kind: "heading", label: "Hero heading", set: { text: "Fall" } })).toBe(
      "Hero heading: “Fall”",
    );
  });

  it("falls back to the element kind, as the design words it", () => {
    expect(describeChange({ kind: "heading", set: { text: "Built for the trail." } })).toBe(
      "Heading: “Built for the trail.”",
    );
    expect(describeChange({ kind: "button", set: { text: "Add to pack" } })).toBe(
      "Button text: “Add to pack”",
    );
    expect(describeChange({ kind: "button", set: { backgroundColor: "#B4532A" } })).toBe(
      "Button: background #B4532A",
    );
  });

  it("lists every property that changed", () => {
    expect(
      describeChange({
        kind: "image",
        set: { src: "https://a.test/x.png", alt: "A campfire" },
      }),
    ).toBe("Image: new image, alt text “A campfire”");
  });

  it("clips long text and collapses whitespace", () => {
    const text = `${"word ".repeat(40)}end`;
    const line = describeChange({ kind: "text", set: { text } });
    expect(line.length).toBeLessThan(100);
    expect(line.endsWith("…”")).toBe(true);
    expect(describeChange({ kind: "text", set: { text: "a\n  b" } })).toBe("Text: “a b”");
  });
});

describe("changeSummaries", () => {
  it("describes each change in stored order", () => {
    expect(
      changeSummaries({
        schemaVersion: 1,
        changes: [
          { kind: "heading", set: { text: "One" } },
          { kind: "button", set: { text: "Two" } },
        ],
      }),
    ).toEqual(["Heading: “One”", "Button text: “Two”"]);
  });
});

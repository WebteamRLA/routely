import { describe, expect, it } from "vitest";

import type { ElementDescriptor } from "@routely/sdk/contract";

import {
  EDITOR_MAX_CHANGES,
  editChange,
  initMessage,
  isEditorImageUrl,
  isFromEditorPage,
  newChangeId,
  readDescriptor,
  readPageMessage,
  removeChange,
  toHexColor,
  toWireChanges,
} from "@/lib/editor-protocol";
import {
  MAX_CHANGES_PER_VARIANT,
  visualChangeSchema,
  visualChangesSchema,
} from "@/validation/visual-change";

const token = "rte1.payload.signature";
const origin = "https://shop.acme.com";
const frame = { name: "the frame" };

const heading: ElementDescriptor = {
  selector: "#hero > h1:nth-of-type(1)",
  kind: "heading",
  label: "Heading · Gear up for fall",
  fingerprint: { tag: "h1", text: "Gear up for fall" },
  current: { text: "Gear up for fall" },
  textEditable: true,
};
const button: ElementDescriptor = {
  selector: "#hero a.cta",
  kind: "button",
  label: "Button · Shop the sale",
  fingerprint: { tag: "a" },
  current: { text: "Shop the sale", backgroundColor: "rgb(31, 61, 43)" },
  textEditable: true,
};
const image: ElementDescriptor = {
  selector: "#hero img",
  kind: "image",
  label: "Image · Hiker",
  fingerprint: { tag: "img", src: "https://shop.acme.com/hiker.jpg" },
  current: { src: "https://shop.acme.com/hiker.jpg", alt: "Hiker" },
  textEditable: false,
};

describe("accepting a message", () => {
  it("needs the exact page origin and the window the editor opened", () => {
    const guard = { origin, source: frame };
    expect(isFromEditorPage({ origin, source: frame }, guard)).toBe(true);
    expect(isFromEditorPage({ origin: "https://evil.test", source: frame }, guard)).toBe(false);
    expect(isFromEditorPage({ origin: "https://acme.com", source: frame }, guard)).toBe(false);
    expect(isFromEditorPage({ origin: "http://shop.acme.com", source: frame }, guard)).toBe(false);
    expect(isFromEditorPage({ origin, source: { name: "another window" } }, guard)).toBe(false);
    // Before the frame exists nothing is accepted — not even a message whose source is also null.
    expect(isFromEditorPage({ origin, source: null }, { origin, source: null })).toBe(false);
  });

  it("needs the session token and a well-formed body", () => {
    const hello = { type: "routely:hello", v: 1, token, url: "https://shop.acme.com/" };
    expect(readPageMessage(hello, token)).toEqual(hello);
    expect(readPageMessage({ ...hello, token: "rte1.other.token" }, token)).toBeNull();
    expect(readPageMessage({ ...hello, v: 2 }, token)).toBeNull();
    expect(readPageMessage({ type: "routely:unknown", token }, token)).toBeNull();
    expect(readPageMessage("routely:hello", token)).toBeNull();
    expect(readPageMessage(null, token)).toBeNull();
    expect(
      readPageMessage({ type: "routely:error", token, code: "agent_load_failed" }, token),
    ).toEqual({
      type: "routely:error",
      token,
      code: "agent_load_failed",
    });
    expect(readPageMessage({ type: "routely:error", token, code: "other" }, token)).toBeNull();
    expect(
      readPageMessage({ type: "routely:applied", token, results: [true, false] }, token),
    ).toEqual({ type: "routely:applied", token, results: [true, false] });
    expect(readPageMessage({ type: "routely:applied", token, results: ["yes"] }, token)).toBeNull();
    expect(readPageMessage({ type: "routely:hover", token, element: null }, token)).toEqual({
      type: "routely:hover",
      token,
      element: null,
    });
  });

  it("re-validates an element descriptor before using any of it", () => {
    expect(readDescriptor(heading)).toEqual(heading);
    expect(readDescriptor({ ...heading, kind: "video" })).toBeNull();
    expect(readDescriptor({ ...heading, selector: "" })).toBeNull();
    expect(readDescriptor({ ...heading, selector: "x".repeat(1001) })).toBeNull();
    expect(readDescriptor({ ...heading, fingerprint: { tag: "h1 onload=x" } })).toBeNull();
    expect(readDescriptor({ ...heading, fingerprint: {} })).toBeNull();
    // Strings are capped, unknown fields dropped, a missing `textEditable` is false.
    const capped = readDescriptor({
      ...heading,
      label: "L".repeat(500),
      current: { text: "t".repeat(30_000), extra: "<script>" },
      textEditable: "yes",
      evil: true,
    });
    expect(capped?.label).toHaveLength(200);
    expect(capped?.current.text).toHaveLength(20_000);
    expect(capped?.current).not.toHaveProperty("extra");
    expect(capped).not.toHaveProperty("evil");
    expect(capped?.textEditable).toBe(false);
    expect(
      readPageMessage({ type: "routely:select", token, element: { ...heading, kind: 1 } }, token),
    ).toBeNull();
  });

  it("answers with the session token", () => {
    expect(initMessage(token)).toEqual({ type: "routely:init", v: 1, token });
  });
});

describe("editing", () => {
  let n = 0;
  const id = () => `c${++n}`;

  it("creates a change the server accepts, and updates it in place", () => {
    const one = editChange([], heading, "text", "Fall sale: 30% off", id);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      selector: heading.selector,
      kind: "heading",
      label: heading.label,
      fingerprint: { tag: "h1", text: "Gear up for fall" },
      original: { text: "Gear up for fall" },
      set: { text: "Fall sale: 30% off" },
    });
    expect(visualChangeSchema.safeParse(one[0]).success).toBe(true);

    const two = editChange(one, button, "backgroundColor", "#b4532a", id);
    const three = editChange(two, button, "text", "Shop fall deals", id);
    expect(three).toHaveLength(2);
    expect(three[1]!.set).toEqual({ backgroundColor: "#b4532a", text: "Shop fall deals" });
    expect(three[1]!.id).toBe(two[1]!.id);
    expect(visualChangesSchema.safeParse(three).success).toBe(true);
  });

  it("drops a value set back to the original, and the change when nothing is left", () => {
    const one = editChange([], button, "text", "Shop fall deals", id);
    const both = editChange(one, button, "backgroundColor", "#b4532a", id);
    const colourBack = editChange(both, button, "backgroundColor", "rgb(31, 61, 43)", id);
    expect(colourBack[0]!.set).toEqual({ text: "Shop fall deals" });
    expect(editChange(colourBack, button, "text", "Shop the sale", id)).toEqual([]);
    // No-op edits return the same list, so they cost no undo step.
    expect(editChange(colourBack, button, "text", "Shop fall deals", id)).toBe(colourBack);
    expect(editChange([], heading, "text", "Gear up for fall", id)).toEqual([]);
  });

  it("swaps images and alt text, and clears a value with undefined", () => {
    const src = editChange([], image, "src", "https://cdn.acme.com/campfire.jpg", id);
    const alt = editChange(src, image, "alt", "Campfire at dusk", id);
    expect(alt[0]!.set).toEqual({
      src: "https://cdn.acme.com/campfire.jpg",
      alt: "Campfire at dusk",
    });
    expect(visualChangeSchema.safeParse(alt[0]).success).toBe(true);
    expect(editChange(alt, image, "src", undefined, id)[0]!.set).toEqual({
      alt: "Campfire at dusk",
    });
    expect(removeChange(alt, image.selector)).toEqual([]);
  });

  it("projects changes to what the SDK reads", () => {
    const list = editChange(editChange([], heading, "text", "Hi", id), image, "alt", "A", id);
    expect(toWireChanges(list)).toEqual([
      {
        selector: heading.selector,
        kind: "heading",
        fingerprint: { tag: "h1" },
        set: { text: "Hi" },
      },
      { selector: image.selector, kind: "image", fingerprint: { tag: "img" }, set: { alt: "A" } },
    ]);
  });

  it("matches the server's caps", () => {
    expect(EDITOR_MAX_CHANGES).toBe(MAX_CHANGES_PER_VARIANT);
    expect(newChangeId()).toMatch(/^c[a-z0-9]{10}$/);
  });
});

describe("values", () => {
  it("converts colours for the colour picker", () => {
    expect(toHexColor("rgb(31, 61, 43)")).toBe("#1f3d2b");
    expect(toHexColor("rgba(31,61,43,0.5)")).toBe("#1f3d2b");
    expect(toHexColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(toHexColor("#ABC")).toBe("#aabbcc");
    expect(toHexColor("#B4532A")).toBe("#b4532a");
    expect(toHexColor("red")).toBeNull();
    expect(toHexColor(undefined)).toBeNull();
  });

  it("accepts only https image URLs", () => {
    expect(isEditorImageUrl("https://cdn.acme.com/a.png")).toBe(true);
    expect(isEditorImageUrl("http://cdn.acme.com/a.png")).toBe(false);
    expect(isEditorImageUrl("javascript:alert(1)")).toBe(false);
    expect(isEditorImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isEditorImageUrl("https://")).toBe(false);
    expect(isEditorImageUrl("https://a.com/" + "x".repeat(2048))).toBe(false);
  });
});

describe("blocks, breadcrumbs and styles", () => {
  const section: ElementDescriptor = {
    selector: "body > section:nth-of-type(2)",
    kind: "block",
    label: "Section",
    fingerprint: { tag: "section" },
    current: {
      backgroundColor: "rgb(19, 33, 61)",
      color: "rgb(255, 255, 255)",
      fontSize: "16px",
      fontWeight: "400",
      textAlign: "center",
      padding: "0px",
      margin: "0px",
    },
    textEditable: false,
    crumbs: ["Group", "Main"],
  };

  it("reads a block descriptor with its styles and breadcrumb, capped", () => {
    const read = readDescriptor({ ...section, crumbs: ["Group", 7, "x".repeat(80)] });
    expect(read?.kind).toBe("block");
    expect(read?.current).toEqual(section.current);
    expect(read?.crumbs).toEqual(["Group", "x".repeat(40)]);
  });

  it("restyles and hides a block as changes the server accepts", () => {
    const styled = editChange([], section, "backgroundColor", "#1F3D2B", () => "c1");
    const hidden = editChange(styled, section, "hidden", true, () => "c2");
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toMatchObject({
      kind: "block",
      original: { backgroundColor: "rgb(19, 33, 61)", padding: "0px" },
      set: { backgroundColor: "#1F3D2B", hidden: true },
    });
    expect(visualChangeSchema.safeParse(hidden[0]).success).toBe(true);
  });

  it("drops a style set back to its original, and showing a hidden block again", () => {
    const one = editChange([], section, "textAlign", "left", () => "c1");
    expect(editChange(one, section, "textAlign", "center", () => "c2")).toEqual([]);
    const hid = editChange([], section, "hidden", true, () => "c3");
    expect(editChange(hid, section, "hidden", undefined, () => "c4")).toEqual([]);
  });
});

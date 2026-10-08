import { describe, expect, it } from "vitest";

import { type ChangeRoot, type ChangeTarget, applyAll, applyChange } from "../src/changes";

/** A minimal element: enough of the DOM for the change applier, no jsdom. */
function element(
  tagName: string,
  attrs: Record<string, string> = {},
): ChangeTarget & {
  styles: Map<string, string>;
  attrs: Map<string, string>;
} {
  const styles = new Map<string, string>();
  const attributes = new Map(Object.entries(attrs));
  return {
    tagName,
    textContent: "original",
    styles,
    attrs: attributes,
    style: {
      getPropertyValue: (name) => styles.get(name) ?? "",
      setProperty: (name, value) => void styles.set(name, value),
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => void attributes.set(name, value),
    removeAttribute: (name) => void attributes.delete(name),
  };
}

/** Resolves a selector list to the first listed selector that is present — like
 * `querySelector`, which returns the first match in document order. */
function root(elements: Record<string, ChangeTarget>): ChangeRoot {
  return {
    querySelector(selector) {
      if (selector.includes("!!")) throw new SyntaxError("invalid selector");
      for (const part of selector.split(",")) {
        const found = elements[part.trim()];
        if (found) return found;
      }
      return null;
    },
  };
}

describe("applyChange", () => {
  it("replaces text", () => {
    const h1 = element("H1");
    expect(applyChange(root({ h1 }), { selector: "h1", prop: "text", value: "New" })).toBe(true);
    expect(h1.textContent).toBe("New");
  });

  it("applies to the first element a selector list matches", () => {
    const tagged = element("H2");
    const h1 = element("H1");
    const list = '[data-routely="headline"], h1';
    applyChange(root({ h1 }), { selector: list, prop: "text", value: "A" });
    expect(h1.textContent).toBe("A");
    applyChange(root({ '[data-routely="headline"]': tagged, h1 }), {
      selector: list,
      prop: "text",
      value: "B",
    });
    expect(tagged.textContent).toBe("B");
  });

  it("sets a background colour that outranks the page's stylesheet", () => {
    const button = element("A");
    applyChange(root({ ".cta": button }), { selector: ".cta", prop: "bg", value: "#F0603F" });
    expect(button.styles.get("background-color")).toBe("#F0603F");
  });

  it("swaps an image's source and drops a srcset that would win over it", () => {
    const img = element("IMG", { src: "/old.png", srcset: "/old@2x.png 2x" });
    applyChange(root({ img }), { selector: "img", prop: "image", value: "https://cdn.test/n.png" });
    expect(img.attrs.get("src")).toBe("https://cdn.test/n.png");
    expect(img.attrs.has("srcset")).toBe(false);
  });

  it("sets a background image on anything that is not an <img>", () => {
    const hero = element("DIV");
    applyChange(root({ ".hero": hero }), { selector: ".hero", prop: "image", value: "/h.jpg" });
    expect(hero.styles.get("background-image")).toBe('url("/h.jpg")');
  });

  it("refuses an image URL that is not http(s) or site-relative", () => {
    const img = element("IMG", { src: "/old.png" });
    applyChange(root({ img }), { selector: "img", prop: "image", value: "javascript:alert(1)" });
    expect(img.attrs.get("src")).toBe("/old.png");
  });

  it("reports a missing element, and treats a selector that throws as no match", () => {
    expect(applyChange(root({}), { selector: "h1", prop: "text", value: "x" })).toBe(false);
    expect(() =>
      applyChange(root({}), { selector: "h1!!", prop: "text", value: "x" }),
    ).not.toThrow();
    expect(applyChange(root({}), { selector: "h1!!", prop: "text", value: "x" })).toBe(false);
  });

  it("is idempotent, so re-applying under a MutationObserver writes nothing new", () => {
    const h1 = element("H1");
    let writes = 0;
    const counted = new Proxy(h1, {
      set(target, key, value) {
        if (key === "textContent") writes += 1;
        return Reflect.set(target, key, value);
      },
    });
    const r = root({ h1: counted });
    applyChange(r, { selector: "h1", prop: "text", value: "Same" });
    applyChange(r, { selector: "h1", prop: "text", value: "Same" });
    expect(writes).toBe(1);
  });

  it("counts how many changes are still waiting for their element", () => {
    const r = root({ h1: element("H1") });
    expect(
      applyAll(r, [
        { selector: "h1", prop: "text", value: "a" },
        { selector: ".later", prop: "text", value: "b" },
      ]),
    ).toBe(1);
  });
});

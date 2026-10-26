import { describe, expect, it, vi } from "vitest";

import {
  type ApplyHost,
  GUARD_MS,
  HARD_STOP_MS,
  MAX_REAPPLY,
  SETTLE_AFTER_READY_MS,
  applyChange,
  applyChanges,
  isApplied,
  isSafeColor,
  isSafeImageUrl,
  isValidChange,
} from "../src/apply";
import type { VisualChange } from "../src/contract";
import { FakeElement, asElement } from "./fake-dom";

const text = (selector: string, value: string, tag = "h1"): VisualChange => ({
  selector,
  kind: "heading",
  fingerprint: { tag },
  set: { text: value },
});

describe("value validation", () => {
  it("accepts only plain colour notations", () => {
    for (const ok of ["#fff", "#A1B2C3", "rgb(1, 2, 3)", "rgba(10,20,30,0.5)"]) {
      expect(isSafeColor(ok)).toBe(true);
    }
    for (const bad of [
      "red",
      "#ffff",
      "url(https://evil.test/x.png)",
      "#fff; background-image:url(x)",
      "expression(alert(1))",
      "rgb(1,2,3);color:red",
      42,
    ]) {
      expect(isSafeColor(bad)).toBe(false);
    }
  });

  it("accepts only absolute http(s) image URLs", () => {
    expect(isSafeImageUrl("https://cdn.test/a.png")).toBe(true);
    expect(isSafeImageUrl("http://cdn.test/a.png")).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "/relative.png",
      "https://cdn.test/" + "a".repeat(2100),
    ]) {
      expect(isSafeImageUrl(bad)).toBe(false);
    }
  });

  it("rejects a change that sets nothing, or any invalid value", () => {
    expect(isValidChange({ selector: "h1", kind: "heading", set: {} })).toBe(false);
    expect(isValidChange({ selector: "h1", kind: "text", set: { text: "x".repeat(2001) } })).toBe(
      false,
    );
    expect(
      isValidChange({
        selector: "a",
        kind: "button",
        set: { text: "Buy", backgroundColor: "red" },
      }),
    ).toBe(false);
    expect(isValidChange(text("h1", "Hello"))).toBe(true);
  });
});

describe("applyChange", () => {
  it("sets text as text, never as markup", () => {
    const h1 = new FakeElement("h1");
    h1.textContent = "Old";
    expect(applyChange(asElement(h1), text("h1", "<img src=x onerror=alert(1)>"))).toBe(true);
    expect(h1.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("sets the value of a submit input", () => {
    const input = new FakeElement("input", { type: "submit" });
    expect(applyChange(asElement(input), text("input", "Buy now", "input"))).toBe(true);
    expect(input.value).toBe("Buy now");
  });

  it("refuses an element whose tag drifted from the fingerprint", () => {
    const p = new FakeElement("p");
    p.textContent = "Keep";
    expect(applyChange(asElement(p), text("h1", "Changed", "h1"))).toBe(false);
    expect(p.textContent).toBe("Keep");
  });

  it("sets a button colour with !important", () => {
    const button = new FakeElement("button");
    const change: VisualChange = {
      selector: "button",
      kind: "button",
      set: { backgroundColor: "#ff0000" },
    };
    expect(applyChange(asElement(button), change)).toBe(true);
    expect(button.style.getPropertyValue("background-color")).toBe("#ff0000");
    expect(button.style.getPropertyPriority("background-color")).toBe("important");
  });

  it("swaps an image inside a <picture>, clearing what would override src", () => {
    const source = new FakeElement("source", { srcset: "old.webp" });
    const img = new FakeElement("img", { src: "old.png", srcset: "old@2x.png 2x", alt: "Old" });
    const picture = new FakeElement("picture").append(source, img);

    const change: VisualChange = {
      selector: "picture",
      kind: "image",
      set: { src: "https://cdn.test/new.png", alt: "New" },
    };
    expect(applyChange(asElement(picture), change)).toBe(true);
    expect(img.getAttribute("src")).toBe("https://cdn.test/new.png");
    expect(img.getAttribute("srcset")).toBeNull();
    expect(img.getAttribute("alt")).toBe("New");
    expect(picture.querySelectorAll("source")).toHaveLength(0);
  });

  it("refuses an unsafe image without touching the element", () => {
    const img = new FakeElement("img", { src: "old.png" });
    const change: VisualChange = { selector: "img", kind: "image", set: { src: "javascript:x" } };
    expect(applyChange(asElement(img), change)).toBe(false);
    expect(img.getAttribute("src")).toBe("old.png");
  });

  it("never throws, even on an element that does", () => {
    const hostile = {
      tagName: "H1",
      get textContent() {
        throw new Error("boom");
      },
    } as unknown as Element;
    expect(applyChange(hostile, text("h1", "x"))).toBe(false);
  });

  it("detects a revert", () => {
    const h1 = new FakeElement("h1");
    const change = text("h1", "New");
    applyChange(asElement(h1), change);
    expect(isApplied(asElement(h1), change)).toBe(true);
    h1.textContent = "Hydrated original";
    expect(isApplied(asElement(h1), change)).toBe(false);
  });
});

/** A page whose elements appear when the test says so, with manually-fired timers. */
function fakeHost() {
  const elements = new Map<string, FakeElement>();
  const timers: { at: number; fn: () => void }[] = [];
  let clock = 0;
  let observer: (() => void) | null = null;
  let ready: (() => void) | null = null;
  const disconnect = vi.fn(() => {
    observer = null;
  });

  const host: ApplyHost = {
    query: (selector) => {
      if (selector === "!!bad") throw new SyntaxError("bad selector");
      return (elements.get(selector) as unknown as Element) ?? null;
    },
    observe: (fn) => {
      observer = fn;
      return disconnect;
    },
    onReady: (fn) => {
      ready = fn;
    },
    setTimeout: (fn, ms) => timers.push({ at: clock + ms, fn }),
  };

  return {
    host,
    disconnect,
    add(selector: string, el: FakeElement) {
      elements.set(selector, el);
      observer?.();
    },
    replace(selector: string, el: FakeElement) {
      elements.set(selector, el);
    },
    mutate: () => observer?.(),
    ready: () => ready?.(),
    advance(ms: number) {
      clock += ms;
      for (const timer of timers.filter((t) => t.at <= clock)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    },
    get observing() {
      return observer !== null;
    },
  };
}

describe("applyChanges", () => {
  it("applies changes as their elements appear, and settles once all are in", () => {
    const page = fakeHost();
    const settled = vi.fn();
    applyChanges([text("#a", "A"), text("#b", "B")], settled, page.host);

    expect(settled).not.toHaveBeenCalled();
    const a = new FakeElement("h1");
    page.add("#a", a);
    expect(a.textContent).toBe("A");
    expect(settled).not.toHaveBeenCalled();

    page.add("#b", new FakeElement("h1"));
    expect(settled).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledWith({ applied: 2, total: 2 });
  });

  it("gives up on a missing element shortly after DOMContentLoaded", () => {
    const page = fakeHost();
    const settled = vi.fn();
    applyChanges([text("#a", "A"), text("#missing", "M")], settled, page.host);
    page.add("#a", new FakeElement("h1"));

    page.ready();
    page.advance(SETTLE_AFTER_READY_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    page.advance(1);
    expect(settled).toHaveBeenCalledWith({ applied: 1, total: 2 });

    // The observer stays only for the revert guard, then is gone.
    expect(page.observing).toBe(true);
    page.advance(GUARD_MS);
    expect(page.disconnect).toHaveBeenCalled();
  });

  it("stops at the hard limit even if the page never finishes loading", () => {
    const page = fakeHost();
    const settled = vi.fn();
    applyChanges([text("#never", "N")], settled, page.host);
    page.advance(HARD_STOP_MS);
    expect(settled).toHaveBeenCalledWith({ applied: 0, total: 1 });
    expect(page.disconnect).toHaveBeenCalled();
  });

  it("re-applies after hydration overwrites the text, a bounded number of times", () => {
    const page = fakeHost();
    applyChanges([text("#a", "Variant")], () => {}, page.host);
    const a = new FakeElement("h1");
    page.add("#a", a);

    a.textContent = "Original";
    page.mutate();
    expect(a.textContent).toBe("Variant");

    // A page that keeps reverting is not fought forever.
    for (let i = 0; i < MAX_REAPPLY + 3; i += 1) {
      a.textContent = "Original";
      page.mutate();
    }
    expect(a.textContent).toBe("Original");
  });

  it("re-applies when a framework replaces the element", () => {
    const page = fakeHost();
    applyChanges([text("#a", "Variant")], () => {}, page.host);
    page.add("#a", new FakeElement("h1"));

    const replacement = new FakeElement("h1");
    replacement.textContent = "Original";
    page.replace("#a", replacement);
    page.mutate();
    expect(replacement.textContent).toBe("Variant");
  });

  it("skips invalid changes and bad selectors without throwing", () => {
    const page = fakeHost();
    const settled = vi.fn();
    expect(() =>
      applyChanges(
        [{ selector: "#x", kind: "button", set: { backgroundColor: "red" } }, text("!!bad", "x")],
        settled,
        page.host,
      ),
    ).not.toThrow();
    page.ready();
    page.advance(SETTLE_AFTER_READY_MS);
    expect(settled).toHaveBeenCalledWith({ applied: 0, total: 2 });
  });

  it("settles immediately when everything is already on the page", () => {
    const page = fakeHost();
    page.add("#a", new FakeElement("h1"));
    const settled = vi.fn();
    applyChanges([text("#a", "A")], settled, page.host);
    expect(settled).toHaveBeenCalledOnce();
  });

  it("contains a throwing settle callback", () => {
    const page = fakeHost();
    page.add("#a", new FakeElement("h1"));
    expect(() =>
      applyChanges(
        [text("#a", "A")],
        () => {
          throw new Error("caller bug");
        },
        page.host,
      ),
    ).not.toThrow();
  });
});

describe("styles and hiding (block changes)", () => {
  const style = (set: VisualChange["set"], tag = "section"): VisualChange => ({
    selector: "#hero",
    kind: "block",
    fingerprint: { tag },
    set,
  });

  it("sets every style key as its own CSS property, !important, and hides with display:none", () => {
    const el = new FakeElement("section");
    const change = style({
      backgroundColor: "#1F3D2B",
      color: "rgb(255, 255, 255)",
      fontSize: "24px",
      fontWeight: "700",
      textAlign: "center",
      padding: "16px 24px",
      margin: "0 auto",
      hidden: true,
    });
    expect(applyChange(asElement(el), change)).toBe(true);
    const names = [
      "background-color",
      "color",
      "font-size",
      "font-weight",
      "text-align",
      "padding",
      "margin",
      "display",
    ];
    const props = Object.fromEntries(
      names.map((name) => [
        name,
        el.style.getPropertyValue(name) + (el.style.getPropertyPriority(name) ? " !" : ""),
      ]),
    );
    expect(props).toEqual({
      "background-color": "#1F3D2B !",
      color: "rgb(255, 255, 255) !",
      "font-size": "24px !",
      "font-weight": "700 !",
      "text-align": "center !",
      padding: "16px 24px !",
      margin: "0 auto !",
      display: "none !",
    });
    expect(isApplied(asElement(el), change)).toBe(true);
  });

  it("notices when the page drops a style it set, so it can re-apply", () => {
    const el = new FakeElement("section");
    const change = style({ fontSize: "24px" });
    applyChange(asElement(el), change);
    el.style.setProperty("font-size", "12px"); // the page's own script, without !important
    expect(isApplied(asElement(el), change)).toBe(false);
  });

  it("refuses the whole change when any style value could reach beyond its property", () => {
    for (const bad of [
      { padding: "1px; background:url(https://evil.test/x)" },
      { margin: "expression(alert(1))" },
      { fontSize: "12px !important" },
      { textAlign: 'center"' },
      { color: "red" },
      { fontWeight: "x".repeat(65) },
    ] as VisualChange["set"][]) {
      const el = new FakeElement("section");
      expect(isValidChange(style({ ...bad, fontSize: bad.fontSize ?? "24px" }))).toBe(false);
      expect(applyChange(asElement(el), style({ ...bad, fontSize: bad.fontSize ?? "24px" }))).toBe(
        false,
      );
      expect(el.style.getPropertyValue("font-size")).toBe("");
    }
  });

  it("accepts a change that only hides, and nothing but `true` for hidden", () => {
    expect(isValidChange(style({ hidden: true }))).toBe(true);
    expect(isValidChange(style({ hidden: false } as unknown as VisualChange["set"]))).toBe(false);
  });
});

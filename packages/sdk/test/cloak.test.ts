import { afterEach, describe, expect, it, vi } from "vitest";

import { coverPage, revealPage } from "../src/cloak";

/**
 * The overlay itself is created by the anti-flickering script the customer pastes into their
 * page, not by the bundle — so what is testable here is the handover: the SDK ends the wait
 * early when that script is present, and does nothing harmful when it is not.
 */

describe("revealPage", () => {
  it("calls the reveal function the anti-flickering script published", () => {
    const reveal = vi.fn();
    revealPage({ __routelyReveal: reveal });

    expect(reveal).toHaveBeenCalledOnce();
  });

  it("does nothing when the anti-flickering script is not installed", () => {
    // A supported installation: the customer gets the tracking and keeps the flicker. It must
    // not be an error path.
    expect(() => revealPage({})).not.toThrow();
  });

  it("ignores a host with no window at all", () => {
    expect(() => revealPage(undefined)).not.toThrow();
    expect(() => revealPage(null)).not.toThrow();
  });

  it("ignores a global that is not a function", () => {
    // The name could collide with something on the host page, so its type is checked rather
    // than assumed.
    expect(() => revealPage({ __routelyReveal: "not a function" })).not.toThrow();
    expect(() => revealPage({ __routelyReveal: 42 })).not.toThrow();
    expect(() => revealPage({ __routelyReveal: null })).not.toThrow();
  });

  it("never lets a throwing host function reach the page", () => {
    const reveal = vi.fn(() => {
      throw new Error("host page is broken");
    });

    expect(() => revealPage({ __routelyReveal: reveal })).not.toThrow();
    expect(reveal).toHaveBeenCalledOnce();
  });

  it("is safe to call more than once", () => {
    // The snippet's own function is idempotent; this asserts the SDK side adds no state that
    // would make a second call misbehave.
    const reveal = vi.fn();
    const host = { __routelyReveal: reveal };

    revealPage(host);
    revealPage(host);

    expect(reveal).toHaveBeenCalledTimes(2);
  });
});

/** A head that holds elements, and a document that finds them by id. */
function fakeDoc() {
  const nodes: { id: string; textContent: string; parentNode: unknown }[] = [];
  const head = {
    appendChild(node: { id: string; parentNode: unknown }) {
      node.parentNode = head;
      nodes.push(node as never);
    },
    removeChild(node: unknown) {
      nodes.splice(nodes.indexOf(node as never), 1);
    },
  };
  const doc = {
    head,
    documentElement: head,
    getElementById: (id: string) => nodes.find((n) => n.id === id) ?? null,
    createElement: () => ({ id: "", textContent: "", parentNode: null }),
  };
  return { doc: doc as unknown as Document, nodes };
}

describe("coverPage", () => {
  afterEach(() => vi.useRealTimers());

  it("puts up a white cover and publishes the function that lifts it", () => {
    const { doc, nodes } = fakeDoc();
    const host: { __routelyReveal?: () => void } = {};
    coverPage(doc, host);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe("routely-cloak");
    expect(nodes[0]!.textContent).toContain("background:#fff");
    revealPage(host);
    expect(nodes).toHaveLength(0);
  });

  it("leaves a cover that is already up alone, so the snippet's stays in charge", () => {
    const { doc, nodes } = fakeDoc();
    coverPage(doc, {});
    const reveal = vi.fn();
    const host = { __routelyReveal: reveal };
    coverPage(doc, host);
    expect(nodes).toHaveLength(1);
    expect(host.__routelyReveal).toBe(reveal);
  });

  it("lifts itself if nothing else does: a page never stays blank", () => {
    vi.useFakeTimers();
    const { doc, nodes } = fakeDoc();
    coverPage(doc, {});
    vi.advanceTimersByTime(2999);
    expect(nodes).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(nodes).toHaveLength(0);
  });

  it("never throws, whatever the page is missing", () => {
    expect(() => coverPage(undefined, {})).not.toThrow();
    expect(() => coverPage({} as Document, {})).not.toThrow();
    expect(() => coverPage(fakeDoc().doc, undefined)).not.toThrow();
  });
});

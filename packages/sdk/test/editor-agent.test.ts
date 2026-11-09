import { describe, expect, it, vi } from "vitest";

import { startAgent } from "../src/editor-agent";

describe("startAgent, loaded a second time", () => {
  it("says ready again for the editor and starts nothing new", () => {
    const parent = { postMessage: vi.fn() };
    const win = {
      __routelyEditor: { origin: "https://app.test", token: "tok_abc", via: "parent" },
      __routelyAgent: true,
      parent,
      location: { href: "https://shop.test/page#_rt_edit=tok_abc" },
      addEventListener: vi.fn(),
      document: { addEventListener: vi.fn() },
    };

    expect(startAgent(win as never)).toBe(false);
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "routely:ready",
        token: "tok_abc",
        url: "https://shop.test/page",
      }),
      "https://app.test",
    );
    expect(win.addEventListener).not.toHaveBeenCalled();
    expect(win.document.addEventListener).not.toHaveBeenCalled();
  });
});

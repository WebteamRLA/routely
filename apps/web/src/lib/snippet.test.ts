import { describe, expect, it } from "vitest";

import { detectSnippet } from "@/lib/snippet-detect";
import {
  OPTIMIZER_OPT_OUT,
  antiFlickerScript,
  buildAntiFlickerSnippet,
  buildInstallSnippet,
} from "@/lib/snippet";

describe("buildInstallSnippet", () => {
  const snippet = buildInstallSnippet({
    sdkUrl: "https://cdn.example.com/sdk.js",
    publicSiteId: "rt_abc123",
  });

  it("asks optimisers not to delay either tag", () => {
    const tags = snippet.match(/<script[^>]*>/g) ?? [];
    expect(tags).toHaveLength(2);
    for (const tag of tags) expect(tag).toContain(OPTIMIZER_OPT_OUT);
  });

  it("loads the tracking tag async, behind an inline anti-flicker block that comes first", () => {
    const [cover, tracking] = snippet.match(/<script[^>]*>/g) ?? [];
    expect(cover).not.toMatch(/\s(async|defer|src)[\s>=]/);
    expect(tracking).toMatch(/^<script async src="https:\/\/cdn\.example\.com\/sdk\.js"/);
    expect(tracking).not.toMatch(/\sdefer[\s>=]/);
    expect(snippet.indexOf("routelyTimeout")).toBeLessThan(snippet.indexOf("data-site-id"));
  });

  it("is still recognised by the install check", () => {
    expect(detectSnippet(snippet, "rt_abc123")).toMatchObject({
      scriptFound: true,
      antiFlickerFound: true,
    });
  });
});

describe("antiFlickerScript", () => {
  it("stands down when a cover exists or already ran, so <head> plus Tag Manager covers once", () => {
    expect(antiFlickerScript()).toContain("d.getElementById(i)||w.__routelyReveal");
  });

  it("is exactly what the <head> block wraps", () => {
    expect(buildAntiFlickerSnippet()).toContain(antiFlickerScript());
  });
});

describe("antiFlickerScript in a browser", () => {
  /** Runs the block against a minimal document; reports whether it put a cover up. */
  function run(painted: boolean): boolean {
    let covered = false;
    const head = { appendChild: () => (covered = true) };
    const document = {
      head,
      getElementById: () => null,
      createElement: () => ({ appendChild() {}, id: "" }),
      createTextNode: () => ({}),
    };
    const window = {
      performance: {
        getEntriesByName: (name: string) =>
          painted && name === "first-contentful-paint" ? [{ name }] : [],
      },
    };
    new Function("document", "window", "setTimeout", antiFlickerScript())(
      document,
      window,
      () => 0,
    );
    return covered;
  }

  it("covers a page that hasn't appeared yet, as from <head>", () => {
    expect(run(false)).toBe(true);
  });

  it("never covers a page that has already appeared, as from Tag Manager: that would be the blink", () => {
    expect(run(true)).toBe(false);
  });
});

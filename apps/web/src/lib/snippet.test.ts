import { describe, expect, it } from "vitest";

import { detectSnippet } from "@/lib/snippet-detect";
import { OPTIMIZER_OPT_OUT, buildInstallSnippet } from "@/lib/snippet";

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

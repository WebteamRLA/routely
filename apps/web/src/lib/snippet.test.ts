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

  it("stays synchronous, with the anti-flicker block first", () => {
    expect(snippet).not.toMatch(/<script[^>]*\s(async|defer)[\s>=]/);
    expect(snippet.indexOf("routelyTimeout")).toBeLessThan(snippet.indexOf("data-site-id"));
  });

  it("is still recognised by the install check", () => {
    expect(detectSnippet(snippet, "rt_abc123")).toMatchObject({
      scriptFound: true,
      antiFlickerFound: true,
    });
  });
});

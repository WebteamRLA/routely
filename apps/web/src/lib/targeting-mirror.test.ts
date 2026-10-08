import { describe, expect, it } from "vitest";

import { matches as sdkMatches } from "@routely/sdk";
import type { PageMatch } from "@/lib/domain";
import { matches } from "@/lib/targeting";

/**
 * The SDK carries its own copy of the page-rule matcher — it cannot import the app — so this
 * runs both over one case table. A URL the wizard's "Test a URL" accepts must be a URL the SDK
 * runs on.
 */
const CASES: [PageMatch, string, string][] = [
  ["exact", "https://acme.com/pricing", "https://acme.com/pricing/"],
  ["exact", "acme.com/pricing", "https://acme.com/pricing?utm_source=x"],
  ["exact", "acme.com/pricing", "https://acme.com/pricing/plans"],
  ["exact", "", "https://acme.com"],
  ["contains", "/blog/", "https://acme.com/en/blog/post"],
  ["contains", "/shop", "https://acme.com/blog"],
  ["starts", "acme.com/blog", "https://acme.com/blog/post"],
  ["starts", "acme.com/blog", "https://www.acme.com/blog"],
  ["wildcard", "acme.com/blog/*", "https://acme.com/blog"],
  ["wildcard", "acme.com/*/pricing", "https://acme.com/en/pricing"],
  ["wildcard", "acme.com/a.b", "https://acme.com/aXb"],
  ["wildcard", "acme.com/(x)?", "https://acme.com/(x)?"],
  ["regex", "utm_source=ads", "https://acme.com/?utm_source=ads"],
  ["regex", "^https://acme\\.com/p$", "https://acme.com/q"],
  ["regex", "([", "https://acme.com/"],
];

describe("page-rule matcher mirror", () => {
  it.each(CASES)("%s %s ~ %s agrees", (match, pattern, url) => {
    expect(sdkMatches(match, pattern, url)).toEqual(matches(match, pattern, url));
  });
});

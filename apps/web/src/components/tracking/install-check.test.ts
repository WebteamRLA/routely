import { describe, expect, it } from "vitest";

import {
  domainResult,
  listDomains,
  problemsOf,
  summariseProblems,
  type DomainResult,
} from "@/components/tracking/install-check";

describe("domainResult", () => {
  it("maps each server answer", () => {
    expect(domainResult({ ok: true, snippetFound: true, wrongSiteId: false })).toEqual({
      kind: "found",
    });
    expect(domainResult({ ok: true, snippetFound: false, wrongSiteId: true })).toEqual({
      kind: "wrong-site",
    });
    expect(domainResult({ ok: true, snippetFound: false, wrongSiteId: false })).toEqual({
      kind: "missing",
    });
    expect(domainResult({ ok: false, message: "We couldn't load https://a.com/." })).toEqual({
      kind: "error",
      message: "We couldn't load https://a.com/.",
    });
  });
});

describe("problemsOf + summariseProblems", () => {
  const domains = ["acme.com", "shop.acme.com", "eu.acme.com"];

  it("is null when every domain was found", () => {
    const results: Record<string, DomainResult> = Object.fromEntries(
      domains.map((d) => [d, { kind: "found" }]),
    );
    expect(summariseProblems(problemsOf(domains, results))).toBeNull();
  });

  it("gives the full reason when one domain failed", () => {
    const base: Record<string, DomainResult> = {
      "acme.com": { kind: "found" },
      "eu.acme.com": { kind: "found" },
    };
    expect(
      summariseProblems(problemsOf(domains, { ...base, "shop.acme.com": { kind: "missing" } })),
    ).toBe("The snippet wasn’t found on shop.acme.com.");
    expect(
      summariseProblems(problemsOf(domains, { ...base, "shop.acme.com": { kind: "wrong-site" } })),
    ).toBe(
      "shop.acme.com has a Routely snippet for a different project. Replace it with the snippet above.",
    );
    expect(
      summariseProblems(
        problemsOf(domains, {
          ...base,
          "shop.acme.com": { kind: "error", message: "shop.acme.com returned HTTP 500." },
        }),
      ),
    ).toBe("shop.acme.com returned HTTP 500.");
  });

  it("lists several failures in domain order with a short reason each", () => {
    const results: Record<string, DomainResult> = {
      "eu.acme.com": { kind: "missing" },
      "acme.com": { kind: "error", message: "We couldn't load https://acme.com/." },
      "shop.acme.com": { kind: "wrong-site" },
    };
    expect(summariseProblems(problemsOf(domains, results))).toBe(
      "Not detected on acme.com (couldn’t load), shop.acme.com (another project’s snippet), eu.acme.com (snippet not found).",
    );
  });

  it("ignores domains that were not checked", () => {
    expect(problemsOf(domains, { "acme.com": { kind: "missing" } })).toEqual([
      { domain: "acme.com", result: { kind: "missing" } },
    ]);
  });
});

describe("listDomains", () => {
  it("joins like prose", () => {
    expect(listDomains([])).toBe("your site");
    expect(listDomains(["acme.com"])).toBe("acme.com");
    expect(listDomains(["acme.com", "shop.acme.com"])).toBe("acme.com and shop.acme.com");
    expect(listDomains(["a.com", "b.com", "c.com"])).toBe("a.com, b.com and c.com");
  });
});

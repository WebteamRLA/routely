import { describe, expect, it } from "vitest";

import {
  URL_RE,
  hostOf,
  isKnownHost,
  isValidDomain,
  normDomain,
  pathOf,
  stripU,
} from "./domain-normalize";

describe("normDomain", () => {
  it("strips protocol, www., path, query and hash and lowercases", () => {
    expect(normDomain("https://www.Example.com/pricing?x=1")).toBe("example.com");
    expect(normDomain("  HTTP://Shop.Acme.io#top ")).toBe("shop.acme.io");
    expect(normDomain("www.acme.com:8080/x")).toBe("acme.com:8080");
    expect(normDomain("app.acme.com?x")).toBe("app.acme.com");
  });

  it("tolerates empty input", () => {
    expect(normDomain("")).toBe("");
    expect(normDomain(null)).toBe("");
    expect(normDomain(undefined)).toBe("");
  });
});

describe("isValidDomain", () => {
  it("requires dotted labels, allows a port", () => {
    expect(isValidDomain("acme.com")).toBe(true);
    expect(isValidDomain("a-b.co.uk:3000")).toBe(true);
    expect(isValidDomain("localhost")).toBe(false);
    expect(isValidDomain("acme .com")).toBe(false);
    expect(isValidDomain("")).toBe(false);
  });
});

describe("URL_RE", () => {
  it("accepts full http(s) URLs only", () => {
    expect(URL_RE.test("https://acme.com")).toBe(true);
    expect(URL_RE.test("http://a.acme.com:8080/x?y=1")).toBe(true);
    expect(URL_RE.test("acme.com/x")).toBe(false);
    expect(URL_RE.test("https://localhost/x")).toBe(false);
    expect(URL_RE.test("ftp://acme.com")).toBe(false);
  });
});

describe("hostOf / pathOf / stripU / isKnownHost", () => {
  it("extracts parts, failing soft", () => {
    expect(hostOf("https://a.acme.com:81/x")).toBe("a.acme.com:81");
    expect(hostOf("nope")).toBe("");
    expect(pathOf("https://acme.com/x?y=1#z")).toBe("/x?y=1");
    expect(pathOf("not a url")).toBe("not a url");
    expect(pathOf("")).toBe("");
  });

  it("stripU drops protocol, query and one trailing slash", () => {
    expect(stripU(" https://acme.com/x/?q=1 ")).toBe("acme.com/x");
    expect(stripU("acme.com/")).toBe("acme.com");
    expect(stripU(null)).toBe("");
  });

  it("isKnownHost accepts subdomains, dot-anchored", () => {
    expect(isKnownHost("acme.com", ["acme.com"])).toBe(true);
    expect(isKnownHost("app.acme.com", ["acme.com"])).toBe(true);
    expect(isKnownHost("evil-acme.com", ["acme.com"])).toBe(false);
    expect(isKnownHost("", ["acme.com"])).toBe(false);
  });
});

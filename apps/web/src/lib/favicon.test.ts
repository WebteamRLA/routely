import { describe, expect, it } from "vitest";

import { MAX_ICON_CANDIDATES, faviconCandidates, sniffImageType } from "@/lib/favicon";

const PAGE = "https://shop.acme.com/";

describe("faviconCandidates", () => {
  it("prefers the touch icon, then the largest declared icon, then /favicon.ico", () => {
    const html = `
      <link rel="icon" href="/fav-16.png" sizes="16x16">
      <link rel="shortcut icon" href="/fav-32.png" sizes="32x32">
      <link rel="apple-touch-icon" href="https://cdn.acme.com/touch.png" sizes="180x180">`;
    expect(faviconCandidates(html, PAGE)).toEqual([
      "https://cdn.acme.com/touch.png",
      "https://shop.acme.com/fav-32.png",
      "https://shop.acme.com/fav-16.png",
      "https://shop.acme.com/favicon.ico",
    ]);
  });

  it("never offers an SVG icon — it would be a script-capable document on Routely's origin", () => {
    const html = `
      <link rel="icon" href="/logo.svg">
      <link rel="icon" type="image/svg+xml" href="/logo-without-extension">
      <link rel="icon" href="/fav.png">`;
    expect(faviconCandidates(html, PAGE)).toEqual([
      "https://shop.acme.com/fav.png",
      "https://shop.acme.com/favicon.ico",
    ]);
  });

  it("falls back to /favicon.ico when the page declares nothing", () => {
    expect(faviconCandidates("<html><head><title>x</title></head></html>", PAGE)).toEqual([
      "https://shop.acme.com/favicon.ico",
    ]);
  });

  it("ignores links that are not icons, data and javascript URLs, and caps the list", () => {
    const html = `
      <link rel="stylesheet" href="/site.css">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="javascript:alert(1)">
      ${Array.from({ length: 8 }, (_, i) => `<link rel=icon href=/i${i}.png>`).join("")}`;
    const out = faviconCandidates(html, PAGE);
    expect(out).toHaveLength(MAX_ICON_CANDIDATES);
    expect(out.every((url) => url.startsWith("https://shop.acme.com/i"))).toBe(true);
  });

  it("reads single-quoted and unquoted attributes in any order", () => {
    const html = `<link href='/a.png' rel='icon'><LINK HREF=/b.ico REL="shortcut icon">`;
    expect(faviconCandidates(html, PAGE)).toEqual([
      "https://shop.acme.com/a.png",
      "https://shop.acme.com/b.ico",
      "https://shop.acme.com/favicon.ico",
    ]);
  });
});

describe("sniffImageType", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

  it("recognises the bitmap formats by their signatures", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImageType(bytes(0x00, 0x00, 0x01, 0x00))).toBe("image/x-icon");
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38))).toBe("image/gif");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    const webp = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("refuses anything else, whatever the server called it — SVG and HTML included", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffImageType(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>'))).toBeNull();
    expect(sniffImageType(enc("<!doctype html><html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

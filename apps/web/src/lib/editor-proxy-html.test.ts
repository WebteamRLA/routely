import { describe, expect, it } from "vitest";

import { escapeAttr, rewriteForEditor } from "@/lib/editor-proxy-html";

const OPTS = {
  baseUrl: "https://shop.acme.com/sale/",
  sdkUrl: "http://localhost:3000/sdk.js",
  apiOrigin: "http://localhost:3000",
  siteId: "rt_new",
};

describe("rewriteForEditor", () => {
  it("adds a base and this app's snippet first in <head>", () => {
    const out = rewriteForEditor('<html><head lang="en"><title>x</title></head></html>', OPTS);
    expect(out).toContain(
      '<head lang="en"><base href="https://shop.acme.com/sale/"><script src="http://localhost:3000/sdk.js" data-site-id="rt_new" data-api="http://localhost:3000"></script><title>',
    );
  });

  it("removes the page's own Routely snippet and anti-flicker block, keeps other scripts", () => {
    const html = `<head>
      <script>var routelyTimeout = 1250; window.__routelyReveal = function(){}</script>
      <script src="https://cdn.example/sdk.js" data-site-id="rt_old"></script>
      <script src="/theme.js"></script></head>`;
    const out = rewriteForEditor(html, OPTS);
    expect(out).not.toContain("rt_old");
    expect(out).not.toContain("routelyTimeout");
    expect(out).toContain('<script src="/theme.js"></script>');
  });

  it("drops meta CSP, frame refusals, refreshes and existing <base> tags", () => {
    const html = `<head><base href="/x/"><meta http-equiv="Content-Security-Policy" content="script-src 'self'">
      <meta http-equiv='refresh' content='0;url=/elsewhere'><meta name="viewport" content="w"></head>`;
    const out = rewriteForEditor(html, OPTS);
    expect(out).not.toMatch(/Content-Security-Policy|refresh|href="\/x\/"/);
    expect(out).toContain('<meta name="viewport" content="w">');
  });

  it("works on documents without <head> or <html>", () => {
    expect(rewriteForEditor("<html><body>Hi</body></html>", OPTS)).toMatch(
      /^<html><head><base [^>]+><script [^>]+><\/script><\/head><body>Hi/,
    );
    expect(rewriteForEditor("<p>Hi</p>", OPTS)).toMatch(/^<head>.*<\/head><p>Hi<\/p>$/);
  });

  it("escapes the values it writes into attributes", () => {
    expect(escapeAttr('a"><script>')).toBe("a&quot;&gt;&lt;script&gt;");
    const out = rewriteForEditor("<head></head>", { ...OPTS, baseUrl: 'https://a.com/"x' });
    expect(out).toContain('href="https://a.com/&quot;x"');
  });
});

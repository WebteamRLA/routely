import { describe, expect, it } from "vitest";

import { runInNewContext } from "node:vm";

import { PAGE_SHIM, editorProxyCsp, escapeAttr, rewriteForEditor } from "@/lib/editor-proxy-html";

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
      `<head lang="en"><base href="https://shop.acme.com/sale/"><script>${PAGE_SHIM}</script><script src="http://localhost:3000/sdk.js" data-site-id="rt_new" data-api="http://localhost:3000"></script><title>`,
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
      /^<html><head><base [^>]+><script>[^<]+<\/script><script [^>]+><\/script><\/head><body>Hi/,
    );
    expect(rewriteForEditor("<p>Hi</p>", OPTS)).toMatch(/^<head>.*<\/head><p>Hi<\/p>$/);
  });

  it("escapes the values it writes into attributes", () => {
    expect(escapeAttr('a"><script>')).toBe("a&quot;&gt;&lt;script&gt;");
    const out = rewriteForEditor("<head></head>", { ...OPTS, baseUrl: 'https://a.com/"x' });
    expect(out).toContain('href="https://a.com/&quot;x"');
  });
});

describe("editorProxyCsp", () => {
  // The proxy is served from the dashboard's own origin; this sandbox is all that keeps the
  // customer's scripts from acting as the dashboard. Do not "fix" this test by relaxing it.
  it("sandboxes the copy into an opaque origin and lets only the app frame it", () => {
    const csp = editorProxyCsp("https://routely.example");
    const directives = csp.split(";").map((d) => d.trim());
    expect(directives).toContain("sandbox allow-scripts");
    expect(csp).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms/);
    expect(directives).toContain("frame-ancestors https://routely.example");
  });
});

/** A sandboxed copy as the browser presents it: cross-origin history URLs and storage refused. */
function sandboxedPage() {
  const calls: unknown[][] = [];
  const refuse = () => {
    throw new Error("SecurityError: The document is sandboxed and lacks 'allow-same-origin'.");
  };
  const history = {
    replaceState(...args: unknown[]) {
      if (typeof args[2] === "string" && args[2].startsWith("https://shop.acme.com")) {
        throw new Error("SecurityError: cannot be created in a document with origin 'null'");
      }
      calls.push(args);
    },
    pushState(...args: unknown[]) {
      calls.push(args);
    },
  };
  const document = Object.defineProperty({}, "cookie", {
    get: refuse,
    set: refuse,
    configurable: true,
  });
  const window: Record<string, unknown> = { history };
  for (const key of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(window, key, { get: refuse, configurable: true });
  }
  runInNewContext(PAGE_SHIM, { window, document });
  return { window, document: document as { cookie: string }, history, calls };
}

describe("PAGE_SHIM", () => {
  it("retries a refused history call without its URL, so the router keeps going", () => {
    const { history, calls } = sandboxedPage();
    expect(() =>
      history.replaceState({ tree: 1 }, "", "https://shop.acme.com/sale/"),
    ).not.toThrow();
    expect(calls).toEqual([[{ tree: 1 }, ""]]);
  });

  it("passes an allowed history call through untouched", () => {
    const { history, calls } = sandboxedPage();
    history.pushState({ a: 1 }, "", "?tab=2");
    expect(calls).toEqual([[{ a: 1 }, "", "?tab=2"]]);
  });

  it("gives storage that throws an in-memory stand-in", () => {
    const { window } = sandboxedPage();
    const store = window["localStorage"] as Storage;
    expect(store.getItem("theme")).toBeNull();
    store.setItem("theme", "dark");
    expect(store.getItem("theme")).toBe("dark");
    expect(store.length).toBe(1);
    expect(store.key(0)).toBe("theme");
    store.clear();
    expect(store.length).toBe(0);
    expect((window["sessionStorage"] as Storage).getItem("x")).toBeNull();
  });

  it("makes a refused cookie read empty and a write harmless", () => {
    const { document } = sandboxedPage();
    expect(document.cookie).toBe("");
    expect(() => {
      document.cookie = "a=1";
    }).not.toThrow();
  });

  it("never throws itself, even with no history at all", () => {
    expect(() => runInNewContext(PAGE_SHIM, { window: {}, document: {} })).not.toThrow();
  });
});

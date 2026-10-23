import { lookup } from "node:dns/promises";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname } from "node:os";
import { gzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isPrivateAddress } from "@/lib/private-address";

import { safeFetch } from "./safe-fetch";

/*
 * A real HTTP server on loopback. With `allowPrivate: false` it must be unreachable; with
 * `allowPrivate: true` (development) it stands in for a customer's site so redirects, limits and
 * decoding can be exercised end to end.
 */
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/page") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<head><script data-site-id="rt_abc"></script></head>');
    } else if (path.startsWith("/hop/")) {
      const n = Number(path.slice(5));
      res.writeHead(302, { location: n > 0 ? `/hop/${n - 1}` : "/page" });
      res.end();
    } else if (path === "/to-metadata") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    } else if (path === "/to-ten") {
      res.writeHead(301, { location: "http://10.0.0.1/" });
      res.end();
    } else if (path === "/to-file") {
      res.writeHead(302, { location: "file:///etc/passwd" });
      res.end();
    } else if (path === "/big") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("x".repeat(10_000));
    } else if (path === "/gzip") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(gzipSync("<p>compressed rt_abc</p>"));
    } else if (path === "/slow") {
      setTimeout(() => res.end("late"), 2_000);
    } else if (path === "/missing") {
      res.writeHead(404);
      res.end("nope");
    } else {
      res.writeHead(200);
      res.end("ok");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("safeFetch — refusals", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost/",
    "http://0.0.0.0/",
  ])("refuses %s", async (url) => {
    const result = await safeFetch(url);
    expect(result).toMatchObject({ ok: false, reason: "blocked_address" });
  });

  it("refuses non-http schemes and credentials", async () => {
    expect(await safeFetch("file:///etc/passwd")).toMatchObject({ reason: "blocked_url" });
    expect(await safeFetch("ftp://example.com/")).toMatchObject({ reason: "blocked_url" });
    expect(await safeFetch("http://user:pw@example.com/")).toMatchObject({
      reason: "blocked_url",
    });
    expect(await safeFetch("not a url")).toMatchObject({ reason: "invalid_url" });
  });

  it("refuses a hostname that resolves to a private address (checked at connect time)", async () => {
    // On a typical Linux box the machine's own hostname resolves to 127.0.1.1 via /etc/hosts.
    const name = hostname();
    const resolved = await lookup(name).catch(() => null);
    if (!resolved || !isPrivateAddress(resolved.address)) return;
    const port = (server.address() as AddressInfo).port;
    expect(await safeFetch(`http://${name}:${port}/page`)).toMatchObject({
      ok: false,
      reason: "blocked_address",
    });
  });

  it("applies the caller's policy to the first URL", async () => {
    const result = await safeFetch(`${base}/page`, {
      allowPrivate: true,
      allowUrl: () => "outside the domain",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "blocked_url",
      message: "outside the domain",
    });
  });
});

describe("safeFetch — redirects", () => {
  it("re-checks every hop: a redirect to the metadata address or 10/8 is refused", async () => {
    // allowPrivate is needed to reach the test server at all, so the hop guard is exercised via
    // the policy hook, which sees every hop's URL.
    const policy = (url: URL) => (url.hostname === "127.0.0.1" ? null : `blocked ${url.hostname}`);
    expect(
      await safeFetch(`${base}/to-metadata`, { allowPrivate: true, allowUrl: policy }),
    ).toMatchObject({ ok: false, reason: "blocked_url", message: "blocked 169.254.169.254" });
    expect(
      await safeFetch(`${base}/to-ten`, { allowPrivate: true, allowUrl: policy }),
    ).toMatchObject({ ok: false, reason: "blocked_url", message: "blocked 10.0.0.1" });
  });

  it("refuses a redirect to a non-http scheme", async () => {
    expect(await safeFetch(`${base}/to-file`, { allowPrivate: true })).toMatchObject({
      ok: false,
      reason: "blocked_url",
    });
  });

  it("follows up to 3 redirects and no more", async () => {
    const ok = await safeFetch(`${base}/hop/2`, { allowPrivate: true });
    expect(ok).toMatchObject({ ok: true, status: 200, redirects: 3 });
    expect(ok.ok && ok.finalUrl).toBe(`${base}/page`);
    expect(await safeFetch(`${base}/hop/3`, { allowPrivate: true })).toMatchObject({
      ok: false,
      reason: "too_many_redirects",
    });
  });
});

describe("safeFetch — limits", () => {
  it("truncates the body at maxBytes", async () => {
    const result = await safeFetch(`${base}/big`, { allowPrivate: true, maxBytes: 1_000 });
    expect(result.ok && result.body.length).toBe(1_000);
    expect(result.ok && result.truncated).toBe(true);
  });

  it("times out", async () => {
    expect(await safeFetch(`${base}/slow`, { allowPrivate: true, timeoutMs: 200 })).toMatchObject({
      ok: false,
      reason: "timeout",
    });
  });

  it("decodes gzip and reports error statuses as values", async () => {
    const gz = await safeFetch(`${base}/gzip`, { allowPrivate: true });
    expect(gz.ok && gz.body).toContain("rt_abc");
    expect(await safeFetch(`${base}/missing`, { allowPrivate: true })).toMatchObject({
      ok: true,
      status: 404,
    });
  });

  it("reports a closed port as a network failure", async () => {
    expect(await safeFetch("http://127.0.0.1:1/", { allowPrivate: true })).toMatchObject({
      ok: false,
      reason: "network",
    });
  });
});

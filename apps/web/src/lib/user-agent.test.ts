import { describe, expect, it } from "vitest";

import { parseUserAgent } from "@/lib/user-agent";

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.52",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  safariIpad:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  operaWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0",
  curl: "curl/8.5.0",
};

it("reads headless Chrome as Chrome, not Safari", () => {
  const ua =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36";
  expect(parseUserAgent(ua).label).toBe("Chrome on Linux");
});

describe("parseUserAgent", () => {
  it.each([
    [UA.chromeMac, "Chrome on macOS", "laptop"],
    [UA.safariIphone, "Safari on iPhone", "phone"],
    [UA.edgeWindows, "Edge on Windows", "laptop"],
    [UA.firefoxLinux, "Firefox on Linux", "laptop"],
    [UA.chromeAndroid, "Chrome on Android", "phone"],
    [UA.chromeIos, "Chrome on iPhone", "phone"],
    [UA.safariIpad, "Safari on iPad", "laptop"],
    [UA.operaWindows, "Opera on Windows", "laptop"],
  ])("%#: %s", (ua, label, kind) => {
    const parsed = parseUserAgent(ua);
    expect(parsed.label).toBe(label);
    expect(parsed.kind).toBe(kind);
  });

  it("falls back without throwing", () => {
    expect(parseUserAgent(null).label).toBe("Unknown browser");
    expect(parseUserAgent("").label).toBe("Unknown browser");
    expect(parseUserAgent(UA.curl).label).toBe("Unknown browser");
    expect(parseUserAgent("x".repeat(100_000)).label).toBe("Unknown browser");
  });
});

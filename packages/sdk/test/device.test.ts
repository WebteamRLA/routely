import { describe, expect, it } from "vitest";

import { classifyDevice, deviceAllowed } from "../src/device";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

describe("classifyDevice", () => {
  it("recognises phones", () => {
    expect(classifyDevice({ userAgent: UA.iphone })).toBe("mobile");
    expect(classifyDevice({ userAgent: UA.androidPhone })).toBe("mobile");
  });

  it("recognises tablets, including iPadOS posing as a Mac", () => {
    expect(classifyDevice({ userAgent: UA.ipad })).toBe("tablet");
    expect(classifyDevice({ userAgent: UA.androidTablet })).toBe("tablet");
    expect(classifyDevice({ userAgent: UA.mac, maxTouchPoints: 5 })).toBe("tablet");
  });

  it("treats a Mac without touch, and Windows, as desktop", () => {
    expect(classifyDevice({ userAgent: UA.mac, maxTouchPoints: 0 })).toBe("desktop");
    // A touch laptop must not become a tablet: only the Mac rule looks at touch points.
    expect(classifyDevice({ userAgent: UA.windows, maxTouchPoints: 10 })).toBe("desktop");
  });

  it("uses client hints when the browser offers them", () => {
    expect(classifyDevice({ userAgent: "reduced", userAgentData: { mobile: true } })).toBe(
      "mobile",
    );
    expect(classifyDevice({ userAgent: UA.windows, userAgentData: { mobile: false } })).toBe(
      "desktop",
    );
  });

  it("falls back to desktop for anything unknown or missing", () => {
    expect(classifyDevice(undefined)).toBe("desktop");
    expect(classifyDevice({})).toBe("desktop");
  });
});

describe("deviceAllowed", () => {
  it("treats an empty or missing list as every device", () => {
    expect(deviceAllowed([], "tablet")).toBe(true);
    expect(deviceAllowed(undefined, "mobile")).toBe(true);
  });

  it("includes only the listed devices", () => {
    expect(deviceAllowed(["desktop", "mobile"], "mobile")).toBe(true);
    expect(deviceAllowed(["desktop", "mobile"], "tablet")).toBe(false);
  });
});

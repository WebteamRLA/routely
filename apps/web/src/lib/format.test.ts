import { describe, expect, it } from "vitest";

import {
  fAgo,
  fDate,
  fDateY,
  fN,
  fP,
  fS,
  formatDuration,
  formatPercent,
  minutesSince,
} from "./format";

describe("formatPercent", () => {
  it("renders a fraction as a percentage", () => {
    expect(formatPercent(0.0732)).toBe("7.3%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("renders an unmeasurable rate as a dash rather than a zero", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatDuration(800)).toBe("0.8s");
    expect(formatDuration(24_000)).toBe("24s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_720_000)).toBe("1h 02m");
  });

  it("renders nothing measured as a dash", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });

  it("renders a genuine zero as zero, not a dash", () => {
    expect(formatDuration(0)).toBe("0.0s");
  });
});

describe("prototype formatters", () => {
  it("fN rounds and groups (en-US)", () => {
    expect(fN(1234.6)).toBe("1,235");
    expect(fN(0)).toBe("0");
    expect(fN(-1500)).toBe("-1,500");
  });

  it("fP and fS", () => {
    expect(fP(0.0412, 2)).toBe("4.12%");
    expect(fP(0.5)).toBe("50.0%");
    expect(fS(0.12)).toBe("+12.0%");
    expect(fS(-0.034)).toBe("−3.4%");
    expect(fS(0)).toBe("+0.0%");
    expect(fS(-0.0004)).toBe("+0.0%");
    expect(fS(0.3, 0)).toBe("+30%");
  });

  it("fAgo buckets minutes", () => {
    expect(fAgo(0)).toBe("Just now");
    expect(fAgo(0.5)).toBe("Just now");
    expect(fAgo(59)).toBe("59m ago");
    expect(fAgo(90)).toBe("2h ago");
    expect(fAgo(1439)).toBe("24h ago");
    expect(fAgo(1440)).toBe("1d ago");
    expect(fAgo(2160)).toBe("2d ago");
  });

  it("minutesSince never goes negative", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(minutesSince("2026-10-08T11:30:30Z", now)).toBe(29);
    expect(minutesSince("2026-10-08T13:00:00Z", now)).toBe(0);
    expect(minutesSince("garbage", now)).toBe(0);
  });

  it("fDate / fDateY in en-US, UTC by default", () => {
    const d = new Date("2026-10-08T23:30:00Z");
    expect(fDate(d)).toBe("Oct 8");
    expect(fDateY(d)).toBe("Oct 8, 2026");
    expect(fDate(d, "Asia/Singapore")).toBe("Oct 9");
    expect(fDateY("2026-01-02T00:00:00Z")).toBe("Jan 2, 2026");
  });
});

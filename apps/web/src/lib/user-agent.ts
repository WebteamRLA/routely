/**
 * A deliberately small User-Agent parser for Settings → "Where you're signed in" and the
 * "New sign-in" email: "Chrome on macOS", "Safari on iPhone", "Edge on Windows".
 *
 * Hand-written rather than a dependency because the output is a display label, not a decision:
 * a wrong guess mislabels a row, it never grants or denies anything. Order matters — most
 * browsers carry the tokens of the ones they descend from (Edge says "Chrome" and "Safari";
 * Chrome says "Safari"), so the more specific tokens are tested first.
 */

export type DeviceKind = "laptop" | "phone";

export interface ParsedUserAgent {
  browser: string;
  os: string;
  /** "Chrome on macOS", or "Unknown browser" when nothing was recognised. */
  label: string;
  kind: DeviceKind;
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bVivaldi\//, "Vivaldi"],
  [/\bYaBrowser\//, "Yandex"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium|HeadlessChrome)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
  [/\bSafari\//, "Safari"],
  [/\bMSIE |\bTrident\//, "Internet Explorer"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\biPod\b/, "iPod"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

function first(table: [RegExp, string][], ua: string): string | null {
  for (const [pattern, name] of table) if (pattern.test(ua)) return name;
  return null;
}

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const text = (ua ?? "").slice(0, 512);
  const browser = first(BROWSERS, text);
  const os = first(SYSTEMS, text);

  const phone =
    /\b(?:iPhone|iPod)\b/.test(text) ||
    (/\bAndroid\b/.test(text) && /\bMobile\b/.test(text)) ||
    /\bMobile\b.*\bFirefox\//.test(text);

  const label =
    browser && os
      ? `${browser} on ${os}`
      : browser
        ? browser
        : os
          ? `Browser on ${os}`
          : "Unknown browser";

  return {
    browser: browser ?? "Unknown",
    os: os ?? "Unknown",
    label,
    kind: phone ? "phone" : "laptop",
  };
}

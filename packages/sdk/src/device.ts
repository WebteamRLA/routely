import type { DeviceType } from "./contract";

/**
 * Device classification for targeting.
 *
 * **This is decided in the browser, and the server cannot check it.** The SDK classifies the
 * device, and a visitor on a device the experiment does not target is simply never entered:
 * no draw, no assignment, nothing reported, page revealed. Ingestion only ever sees visitors the
 * SDK let in, so it has nothing to verify against — a modified client could enter itself into a
 * test it was excluded from, exactly as it could forge any other event. That is the same trust
 * level as the rest of the browser-side decision, and it moves no metric for anyone but itself.
 *
 * The user-agent string decides, not the viewport. Viewport width is what a responsive layout
 * uses, but it is a poor proxy for the *device*: a touch laptop, a narrow desktop window and a
 * phone in landscape all land on the wrong side of any threshold. The rules are the commonly
 * used ones, in this order:
 *
 *  1. **Tablet** — an iPad user agent; iPadOS 13+, which reports itself as `Macintosh` and is
 *     told apart by touch support (`maxTouchPoints > 1`, which no Mac has); or Android without
 *     the `Mobile` token, which is how Android tablets identify themselves.
 *  2. **Mobile** — `navigator.userAgentData.mobile` where the browser offers it (Chromium's
 *     client hints, which survive user-agent reduction), otherwise the `Mobi` / `iPhone` /
 *     `iPod` / `Android … Mobile` tokens.
 *  3. **Desktop** — everything else, including anything unrecognised.
 */

/** The subset of `navigator` this reads, so it can be tested without a browser. */
export interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
}

export function classifyDevice(nav: NavigatorLike | undefined): DeviceType {
  const ua = (nav && nav.userAgent) || "";

  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)) {
    return "tablet";
  }
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return "tablet";
  if (nav?.userAgentData?.mobile === true) return "mobile";
  if (/Mobi|iPhone|iPod|Android.*Mobile/.test(ua)) return "mobile";
  return "desktop";
}

/** The current browser's device class. Never throws. */
export function currentDevice(): DeviceType {
  try {
    return classifyDevice(typeof navigator === "undefined" ? undefined : navigator);
  } catch {
    return "desktop";
  }
}

/** True when an experiment targeting `devices` (empty or absent = all) includes `device`. */
export function deviceAllowed(devices: DeviceType[] | undefined, device: DeviceType): boolean {
  return !devices || devices.length === 0 || devices.indexOf(device) >= 0;
}

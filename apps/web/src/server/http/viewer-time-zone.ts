import "server-only";

import { cookies } from "next/headers";

import { VIEWER_TIME_ZONE_COOKIE } from "@/lib/viewer-time-zone";

/** A zone `Intl` accepts, or UTC. */
export function safeTimeZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/**
 * The viewer's time zone from the `rt_tz` cookie the results screens set, or UTC when it is
 * missing or not a zone `Intl` knows. Only labels use it; nothing is authorized or bucketed by it.
 */
export async function readViewerTimeZone(): Promise<string> {
  const raw = (await cookies()).get(VIEWER_TIME_ZONE_COOKIE)?.value;
  if (!raw) return "UTC";
  try {
    return safeTimeZone(decodeURIComponent(raw));
  } catch {
    return "UTC";
  }
}

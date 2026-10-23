"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { VIEWER_TIME_ZONE_COOKIE } from "@/lib/viewer-time-zone";

/** One corrective refresh per page load at most, whatever the server makes of the cookie. */
let refreshed = false;

/**
 * Stores the browser's time zone for the server to format dates in, and refreshes once when the
 * page was rendered in a different zone (first visit, or after travelling).
 *
 * `renderedIn` is the zone the server actually used.
 */
export function useViewerTimeZone(renderedIn: string): void {
  const router = useRouter();
  useEffect(() => {
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone || zone === renderedIn) return;
    document.cookie = `${VIEWER_TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
    if (refreshed) return;
    refreshed = true;
    router.refresh();
  }, [renderedIn, router]);
}

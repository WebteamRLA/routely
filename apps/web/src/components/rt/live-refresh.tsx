"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** How often a visible screen with live data re-reads it. */
export const LIVE_REFRESH_MS = 15_000;

/**
 * Keeps a server-rendered screen's numbers current: re-reads its server data every
 * `intervalMs` while the tab is visible, and at once when the tab becomes visible again.
 *
 * `router.refresh()` re-renders the page's Server Components in place — client state (an open
 * dialog, a filter, text being typed) is kept, and the screens adopt the new rows as they arrive.
 * Nothing runs in a background tab, so an idle dashboard costs no queries.
 */
export function LiveRefresh({
  enabled = true,
  intervalMs = LIVE_REFRESH_MS,
}: {
  enabled?: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const visible = () => document.visibilityState === "visible";
    const timer = window.setInterval(() => {
      if (visible()) router.refresh();
    }, intervalMs);
    const onVisibility = () => {
      if (visible()) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, router]);
  return null;
}

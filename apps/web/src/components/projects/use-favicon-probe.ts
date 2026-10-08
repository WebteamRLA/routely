"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isValidDomain, normDomain } from "@/lib/domain-normalize";

export type IconProbe =
  | { status: "idle" }
  | { status: "loading" | "fail"; domain: string }
  | { status: "ok"; domain: string; src: string };

const PER_IMAGE_MS = 3000;
const OVERALL_MS = 9000;

function candidates(dm: string): string[] {
  return [
    `https://${dm}/apple-touch-icon.png`,
    `https://${dm}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${dm}.ico`,
    `https://www.google.com/s2/favicons?domain=${dm}&sz=128`,
  ];
}

/**
 * The project modal's icon preview, exactly as the prototype's `fetchIcon` (DESIGN.md §4): each
 * candidate is loaded as an `Image()` (3 s each, 9 s overall, no referrer) and accepted when at
 * least 8px wide — 32px for Google, whose fallback globe is 16px. Token-guarded so a stale
 * probe never overwrites a newer one. Preview only: the server detects and stores the icon on
 * save.
 */
export function useFaviconProbe(initial: IconProbe = { status: "idle" }) {
  const [probe, setProbe] = useState<IconProbe>(initial);
  const token = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(probe);
  useEffect(() => {
    latest.current = probe;
  }, [probe]);

  const run = useCallback((raw: string) => {
    const dm = normDomain(raw);
    if (!isValidDomain(dm)) {
      token.current += 1;
      setProbe({ status: "idle" });
      return;
    }
    const cur = latest.current;
    if (cur.status !== "idle" && cur.domain === dm && cur.status !== "fail") return;
    const tok = ++token.current;
    setProbe({ status: "loading", domain: dm });
    const list = candidates(dm);
    const started = Date.now();
    const tryOne = (i: number) => {
      if (tok !== token.current) return;
      if (i >= list.length || Date.now() - started > OVERALL_MS) {
        setProbe({ status: "fail", domain: dm });
        return;
      }
      const src = list[i]!;
      const im = new Image();
      let done = false;
      const fin = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (tok !== token.current) return;
        if (ok) setProbe({ status: "ok", domain: dm, src });
        else tryOne(i + 1);
      };
      const timer = setTimeout(() => fin(false), PER_IMAGE_MS);
      im.onload = () => fin(im.naturalWidth >= (src.includes("google.com") ? 32 : 8));
      im.onerror = () => fin(false);
      im.referrerPolicy = "no-referrer";
      im.src = src;
    };
    tryOne(0);
  }, []);

  /** Typing: probe 600 ms after the last keystroke. */
  const onUrlChange = useCallback(
    (raw: string) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => run(raw), 600);
    },
    [run],
  );

  /** Blur: probe now. */
  const onUrlBlur = useCallback(
    (raw: string) => {
      if (debounce.current) clearTimeout(debounce.current);
      run(raw);
    },
    [run],
  );

  const reset = useCallback((next: IconProbe = { status: "idle" }) => {
    token.current += 1;
    if (debounce.current) clearTimeout(debounce.current);
    setProbe(next);
  }, []);

  useEffect(
    () => () => {
      token.current += 1;
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  return { probe, onUrlChange, onUrlBlur, reset };
}

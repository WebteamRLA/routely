"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A project's tile: its website's favicon (`/api/favicon/<id>`) on white once that has loaded, and
 * the design's coloured letter tile until then — and for good when the site has no usable icon
 * (the route answers 404), so a tile never shows a broken image.
 *
 * Sized and shaped by `className`, exactly like the letter tile it replaces.
 */
export function ProjectAvatar({
  id,
  initial,
  color,
  ink,
  className,
}: {
  id: string;
  initial: string;
  color: string;
  ink: string;
  className?: string;
}) {
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");
  const img = useRef<HTMLImageElement>(null);

  // An image that finished before hydration fired its load event before React was listening.
  useEffect(() => {
    const el = img.current;
    if (el?.complete) setState(el.naturalWidth > 0 ? "ready" : "none");
  }, []);

  const ready = state === "ready";
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden",
        className,
        ready && "border border-[#EEF0F3]",
      )}
      style={ready ? { background: "#FFFFFF" } : { background: color, color: ink }}
    >
      {ready ? null : initial}
      {state === "none" ? null : (
        // A plain <img>: the route serves a tiny, already-cached bitmap; there is nothing for the
        // Next.js image optimiser to do, and it would need the remote host allow-listed.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={img}
          src={`/api/favicon/${encodeURIComponent(id)}`}
          alt=""
          decoding="async"
          onLoad={() => setState("ready")}
          onError={() => setState("none")}
          className={cn("absolute size-[58%] object-contain", ready ? "" : "invisible")}
        />
      )}
    </span>
  );
}

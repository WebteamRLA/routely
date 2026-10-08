import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One numbered step in a guided sequence.
 *
 * The connecting rule is drawn by the step itself rather than by the container, so steps can
 * be added or reordered without the caller maintaining "is this the last one" logic — the
 * final step simply passes `last`.
 */
export function Step({
  number,
  title,
  description,
  children,
  last = false,
}: {
  number: number;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-4">
      {!last ? (
        <span aria-hidden className="absolute top-8 bottom-0 left-[0.8125rem] w-px bg-divider" />
      ) : null}

      <span
        aria-hidden
        className="relative mt-[3px] grid size-[26px] shrink-0 place-items-center rounded-full bg-coral font-heading text-[12.5px] font-bold text-white"
      >
        {number}
      </span>

      <div className={cn("min-w-0 flex-1 space-y-3", last ? "pb-0" : "pb-8")}>
        <div className="space-y-1">
          <h4 className="font-heading text-[14.5px] leading-8 font-bold tracking-[-0.01em]">
            {title}
          </h4>
          {description ? (
            <p className="text-[13px] leading-normal text-pretty text-ink-2">{description}</p>
          ) : null}
        </div>
        {children}
      </div>
    </li>
  );
}

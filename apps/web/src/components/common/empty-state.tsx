import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Call to action that resolves the empty state, e.g. "Add website". */
  action?: ReactNode;
  className?: string;
}

/**
 * Shown when a collection is legitimately empty — a first-run state, not a failure. Pair it
 * with an action so the screen always tells the user what to do next.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-[#CBD1DC] bg-card px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="grid size-11 place-items-center rounded-lg bg-brand-tint-2 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
      ) : (
        <div aria-hidden className="flex gap-1.5">
          <span className="h-[46px] w-[34px] rounded-md bg-brand" />
          <span className="h-[46px] w-[34px] rounded-md bg-coral" />
        </div>
      )}
      <h2 className="mt-1.5 font-heading text-xl font-semibold">{title}</h2>
      {description ? (
        <p className="max-w-[440px] text-sm leading-relaxed text-balance text-ink-3">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2.5">{action}</div> : null}
    </div>
  );
}

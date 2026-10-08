import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Primary actions, rendered right-aligned on wide screens and stacked on mobile. */
  actions?: ReactNode;
  /** Breadcrumbs or a back link, rendered above the title. */
  eyebrow?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="mb-2 text-[13px] font-bold text-ink-3">{eyebrow}</div> : null}
        <h1 className="m-0 truncate font-heading text-[clamp(22px,2.4vw,26px)] font-bold tracking-[-0.02em]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-pretty text-ink-3">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

const TITLE_SIZE = {
  14.5: "text-[14.5px]",
  15: "text-[15px]",
  15.5: "text-[15.5px]",
  16: "text-base",
} as const;

/**
 * Card heading: Sora 700, -0.01em. 14.5px by default; the design uses 15px on the dashboard and
 * projects lists, 15.5px on settings cards and 16px on the review step.
 */
export function CardTitle({
  children,
  size = 14.5,
  as: Tag = "h2",
  className,
  id,
}: {
  children: ReactNode;
  size?: keyof typeof TITLE_SIZE;
  as?: "h2" | "h3" | "div";
  className?: string;
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={cn("m-0 font-heading font-bold tracking-[-0.01em]", TITLE_SIZE[size], className)}
    >
      {children}
    </Tag>
  );
}

/**
 * White card, 1px #E4E7EE, 8px radius — the design's section container. Pass `title` (and
 * `meta`/`action`) for the standard header row, or compose a bespoke header as children.
 * `padded` is the design's form card (22px padding, column; set the gap with `className`).
 * `clip` clips content to the radius (cards with header rows, tables or tinted rows).
 */
export function Section({
  title,
  meta,
  action,
  children,
  className,
  bodyClassName,
  padded = false,
  clip = false,
  as: Tag = "section",
  ...rest
}: {
  title?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
  clip?: boolean;
  as?: "section" | "div" | "aside";
} & Omit<HTMLAttributes<HTMLElement>, "title" | "className" | "children">) {
  return (
    <Tag
      className={cn(
        "rounded-lg border border-border bg-card",
        padded && "flex flex-col p-[22px]",
        clip && "overflow-hidden",
        className,
      )}
      {...rest}
    >
      {title || action ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-baseline gap-2.5">
            {title ? <CardTitle>{title}</CardTitle> : null}
            {meta ? <span className="text-[12.5px] text-ink-3">{meta}</span> : null}
          </div>
          {action}
        </div>
      ) : null}
      {bodyClassName !== undefined ? <div className={bodyClassName}>{children}</div> : children}
    </Tag>
  );
}

/** Small uppercase label with the coral diamond ("OVERVIEW · LAST 14 DAYS"). */
export function Eyebrow({
  children,
  tone = "grey",
  className,
}: {
  children: ReactNode;
  tone?: "grey" | "coral";
  className?: string;
}) {
  if (tone === "coral")
    return (
      <div
        className={cn("text-xs font-extrabold tracking-[0.08em] text-coral uppercase", className)}
      >
        {children}
      </div>
    );
  return <div className={cn("eyebrow", className)}>{children}</div>;
}

/** The design's page header: optional eyebrow, Sora H1, subtitle, right-aligned actions. */
export function PageTitle({
  eyebrow,
  title,
  sub,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1
          className={cn(
            "font-heading text-[clamp(22px,2.4vw,26px)] font-bold tracking-[-0.02em] text-pretty",
            eyebrow ? "mt-2 mb-1" : "mb-1.5",
          )}
        >
          {title}
        </h1>
        {sub ? <div className="text-sm text-pretty text-ink-3">{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Joined strip: tiles separated by 1px gaps on the border colour (KPIs, arm scorecards). */
export function KpiStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-px overflow-hidden rounded-lg border border-border bg-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** KPI tile; with `href` the whole tile is a link with the design's hover. */
export function KpiTile({
  label,
  value,
  delta,
  deltaColor,
  sub,
  href,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaColor?: string;
  sub?: ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <span className="text-[12.5px] font-bold text-ink-3">{label}</span>
      <span className="font-heading text-[30px] leading-[1.1] font-bold tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      {delta || sub ? (
        <span className="text-[12.5px] text-ink-3">
          {delta ? (
            <span className="font-extrabold" style={{ color: deltaColor }}>
              {delta}
            </span>
          ) : null}{" "}
          {sub}
        </span>
      ) : null}
    </>
  );
  const cls = cn("flex flex-[1_1_150px] flex-col gap-1.5 bg-card px-[22px] py-5", className);
  if (!href) return <div className={cls}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(
        cls,
        "text-left text-foreground no-underline outline-none hover:bg-subtle hover:text-foreground hover:no-underline focus-visible:ring-3 focus-visible:ring-primary/15 focus-visible:ring-inset",
      )}
    >
      {body}
    </Link>
  );
}

/** Settings stat tile. */
export function StatTile({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-divider px-3.5 py-3", className)}>
      <div className="text-xs font-bold text-ink-3">{label}</div>
      <div className="mt-1 font-heading text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

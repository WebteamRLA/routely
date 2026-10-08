import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Ring spinner. `onBlue` for use inside primary buttons. */
export function Spinner({
  size = 14,
  onBlue = false,
  thickness,
  className,
}: {
  size?: number;
  onBlue?: boolean;
  /** Ring width; defaults to 2 / 2.5 (≥18px) / 3 (≥30px). */
  thickness?: number;
  className?: string;
}) {
  const w = thickness ?? (size >= 30 ? 3 : size >= 18 ? 2.5 : 2);
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 animate-rl-spin rounded-full", className)}
      style={{
        width: size,
        height: size,
        border: `${w}px solid ${onBlue ? "rgba(255,255,255,0.35)" : "#D5DEFB"}`,
        borderTopColor: onBlue ? "#FFFFFF" : "#2B59F0",
      }}
    />
  );
}

const BANNER = {
  info: "bg-brand-tint-2 text-[#1F3FB0]",
  hint: "bg-brand-tint text-[#1F3FB0]",
  warning: "bg-[#FDF3E1] text-[#7A4E07]",
  success: "border border-success-border bg-success-bg-2 text-success-strong",
  error: "border border-danger-border bg-danger-bg text-danger-text",
} as const;

/** Tinted banner with a diamond marker. */
export function Banner({
  tone = "info",
  children,
  action,
  className,
}: {
  tone?: keyof typeof BANNER;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const diamond = {
    info: "bg-brand",
    hint: "bg-brand",
    warning: "bg-[#E0A526]",
    success: "bg-success",
    error: "bg-danger",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-lg px-4 py-3 text-[13.5px] font-semibold",
        BANNER[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-[7px] shrink-0 rotate-45", diamond)} />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** 20px issue icon: blocking (red "!"), warning (amber "!"), passed (green "✓"). */
export function IssueIcon({
  kind,
  className,
}: {
  kind: "block" | "warn" | "pass";
  className?: string;
}) {
  const s = {
    block: "bg-danger text-white",
    warn: "bg-[#FDF3E1] text-[#94600A]",
    pass: "bg-[#E6F5EE] text-success-text",
  }[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-black",
        s,
        className,
      )}
    >
      {kind === "pass" ? "✓" : "!"}
    </span>
  );
}

/** Numbered step circle (design L1687): done (green), current (blue), todo (navy). */
export function StepCircle({ n, state }: { n: ReactNode; state: "done" | "current" | "todo" }) {
  return (
    <span
      className={cn(
        "grid size-[26px] shrink-0 place-items-center rounded-full font-heading text-[12.5px] font-bold text-white",
        state === "done" ? "bg-success" : state === "current" ? "bg-brand" : "bg-navy",
      )}
    >
      {n}
    </span>
  );
}

export function Diamond({ size = 7, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rotate-45 bg-coral", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Coral-diamond bullet list. */
export function Bullets({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-2 p-0", className)}>
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5 text-[13px] leading-normal text-ink-2">
          <Diamond size={5} className="mt-[7px]" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** Small tag: uppercase variants (Current, Recommended, Leading) and plain ones. */
export function Tag({
  children,
  tone = "grey",
  upper = true,
  className,
}: {
  children: ReactNode;
  tone?: "navy" | "green" | "blue" | "grey" | "amber" | "red";
  upper?: boolean;
  className?: string;
}) {
  const t = {
    navy: "bg-navy text-white",
    green: "bg-[#E6F5EE] text-success-text",
    blue: "bg-brand-tint-2 text-[#2347C8]",
    grey: "bg-divider text-ink-2",
    amber: "bg-[#FDF3E1] text-[#94600A]",
    red: "bg-danger-bg text-danger-text",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm whitespace-nowrap",
        upper
          ? "px-1.5 py-0.5 text-[10.5px] font-extrabold tracking-[0.05em] uppercase"
          : "px-2 py-0.5 text-[11.5px] font-bold",
        t,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Rounded result pill ("✓ Total 100%"), announced as a status. */
export function ResultPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      role="status"
      className={cn(
        "rounded-[20px] px-2.5 py-1 text-[13px] font-extrabold",
        ok ? "bg-[#E6F5EE] text-success-text" : "bg-[#FCE9E6] text-danger-text",
      )}
    >
      {children}
    </span>
  );
}

/** Shimmer block. */
export function Shimmer({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer rounded-lg", className)} />;
}

/** The design's error card with a navy retry. */
export function ErrorCard({
  eyebrow,
  title,
  body,
  action,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-danger-border bg-card px-6 py-8",
        className,
      )}
    >
      {eyebrow ? (
        <div className="text-xs font-extrabold tracking-[0.08em] text-danger-text uppercase">
          {eyebrow}
        </div>
      ) : null}
      <div className="font-heading text-lg font-semibold">{title}</div>
      {body ? <div className="max-w-[560px] text-ink-3">{body}</div> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

/** Dashed empty card with the blue/coral mark. */
export function EmptyCard({
  title,
  body,
  actions,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-[#CBD1DC] bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <div aria-hidden className="flex gap-1.5">
        <span className="h-[46px] w-[34px] rounded-md bg-brand" />
        <span className="h-[46px] w-[34px] rounded-md bg-coral" />
      </div>
      <div className="mt-1.5 font-heading text-xl font-semibold">{title}</div>
      {body ? <div className="max-w-[440px] leading-relaxed text-ink-3">{body}</div> : null}
      {actions ? <div className="mt-2 flex flex-wrap justify-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

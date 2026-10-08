import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Browser chrome bar (design L1879, L1933): three dots and a mono URL pill. */
export function BrowserBar({ url, className }: { url: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border bg-muted px-3 py-[9px]",
        className,
      )}
    >
      {[0, 1, 2].map((k) => (
        <span key={k} className="size-[9px] shrink-0 rounded-full bg-input" />
      ))}
      <span className="ml-2 min-w-0 flex-1 truncate rounded-md border border-border bg-white px-2.5 py-1 font-mono text-[11.5px] text-ink-2">
        {url}
      </span>
    </div>
  );
}

/** The striped image-placeholder background (design L1889). */
export const STRIPES = "repeating-linear-gradient(45deg,#EEF0F4 0 10px,#F7F8FA 10px 20px)";

/** Review summary row: 140px label, value, optional "Edit" link (design L1234–1238). */
export function SummaryRow({
  label,
  children,
  onEdit,
}: {
  label: string;
  children: ReactNode;
  onEdit?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-5 gap-y-1.5 border-t border-divider px-5 py-3.5">
      <div className="flex-[0_0_140px] pt-px text-[13px] font-bold text-ink-3">{label}</div>
      <div className="min-w-0 flex-[1_1_280px]">{children}</div>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label.toLowerCase()}`}
          className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-bold text-brand hover:underline"
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}

/** Navy strip ("In plain English", wizard summaries). */
export function NavyStrip({
  eyebrow,
  children,
  className,
}: {
  eyebrow?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg bg-navy px-[18px] py-4 text-white", className)}>
      {eyebrow ? (
        <div className="mb-1.5 text-[11px] font-extrabold tracking-[0.12em] text-coral uppercase">
          {eyebrow}
        </div>
      ) : null}
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

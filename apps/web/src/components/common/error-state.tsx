"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Digest of the underlying error, shown so a user can quote it in a bug report. */
  digest?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Rendered by `error.tsx` boundaries. It deliberately never surfaces the raw error message,
 * which may contain internals; `digest` is the safe identifier Next.js exposes for
 * correlating a user report with a server log line.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We could not load this page. Try again, and if it keeps happening let us know.",
  digest,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-danger-border bg-card px-6 py-8",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs font-extrabold tracking-[0.08em] text-danger-text uppercase">
        <AlertTriangle className="size-3.5" aria-hidden />
        Couldn&rsquo;t load
      </div>
      <h2 className="font-heading text-lg font-semibold">{title}</h2>
      <p className="max-w-[560px] text-sm text-ink-3">{description}</p>
      {digest ? <p className="font-mono text-xs text-ink-3">Reference: {digest}</p> : null}
      {onRetry ? (
        <Button variant="dark" className="mt-1.5" onClick={onRetry}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

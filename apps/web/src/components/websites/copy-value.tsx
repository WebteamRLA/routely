"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A read-only value with a copy button.
 *
 * `navigator.clipboard` is unavailable on insecure origins and can be denied by permission,
 * so a failure falls back to selecting the text — the user can still copy it manually rather
 * than being left with a button that appears to do nothing.
 */
export function CopyValue({
  value,
  label,
  className,
}: {
  value: string;
  /** Announced to screen readers on the button, e.g. "Copy public site id". */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const valueRef = useRef<HTMLSpanElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clear the pending reset if the component unmounts mid-timeout.
  useEffect(() => () => clearTimeout(timeout.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      const node = valueRef.current;
      if (!node) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border border-input bg-subtle pr-1 pl-3",
        className,
      )}
    >
      <span ref={valueRef} className="min-w-0 flex-1 truncate font-mono text-[12.5px] select-all">
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-7"
        onClick={copy}
        aria-label={copied ? "Copied" : label}
      >
        {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

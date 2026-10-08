"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A copyable code block.
 *
 * The code is rendered as text, never as markup, so a value interpolated into it cannot
 * become live HTML. Long lines scroll inside the block rather than widening the page.
 *
 * `navigator.clipboard` is unavailable on insecure origins and can be denied by permission,
 * so a failure selects the text instead — the user can still copy manually rather than
 * pressing a button that silently does nothing.
 */
export function CodeBlock({
  code,
  label = "Copy code",
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      const node = codeRef.current;
      if (!node) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  return (
    <div className={cn("flex items-start gap-3 rounded-lg bg-navy px-4 py-3.5", className)}>
      <pre className="m-0 min-w-0 flex-1 overflow-x-auto">
        <code
          ref={codeRef}
          className="font-mono text-[12.5px] leading-relaxed whitespace-pre text-[#C9D6FF]"
        >
          {code}
        </code>
      </pre>

      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : label}
        className="h-[30px] shrink-0 cursor-pointer rounded-md bg-brand px-3 text-[12.5px] font-extrabold text-white outline-none hover:bg-[#3D69F5] focus-visible:ring-3 focus-visible:ring-white/40"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>

      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

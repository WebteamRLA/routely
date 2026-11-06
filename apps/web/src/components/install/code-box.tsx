"use client";

import { useEffect, useRef, useState } from "react";

import { CopyIcon } from "@/components/rt/icons";
import { focusRing } from "@/components/rt/styles";
import { cn } from "@/lib/utils";

/** A block of code to paste somewhere, with a Copy button. */
export function CodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function copy() {
    try {
      void navigator.clipboard?.writeText(code).catch(() => {});
    } catch {
      // No clipboard (insecure context, permissions): the code stays selectable.
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-[#EEF0F3] bg-[#F3F4F6]">
      <div className="flex items-center justify-end gap-2 border-b border-[#E5E7EB] py-1.5 pr-2 pl-3.5">
        <button
          type="button"
          onClick={copy}
          className={cn(
            "inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-[#374151]",
            focusRing,
          )}
          style={{
            borderColor: copied ? "#BBF7D0" : "#E5E7EB",
            background: copied ? "#ECFDF5" : "#FFFFFF",
          }}
        >
          <CopyIcon size={14} />
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="m-0 overflow-x-auto px-3.5 pt-3 pb-3.5 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[13px] leading-[19px] break-normal [overflow-wrap:anywhere] whitespace-pre-wrap text-[#111827]">
        {code}
      </pre>
    </div>
  );
}

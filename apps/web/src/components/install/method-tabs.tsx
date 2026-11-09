"use client";

import { ACCENT_INK, focusRing } from "@/components/rt/styles";
import type { InstallMethodName } from "@/lib/install-verification";
import { cn } from "@/lib/utils";

const METHODS: { value: InstallMethodName; label: string }[] = [
  { value: "GTM", label: "Google Tag Manager" },
  { value: "MANUAL", label: "Manual installation" },
];

const PANEL_ID = "rt-install-panel";
const tabId = (method: InstallMethodName) => `rt-install-tab-${method}`;

/** Spread on whatever the tabs control. */
export function methodPanelProps(method: InstallMethodName) {
  return { role: "tabpanel", id: PANEL_ID, "aria-labelledby": tabId(method) } as const;
}

export function MethodTabs({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: InstallMethodName;
  onChange(method: InstallMethodName): void;
  disabled?: boolean;
  className?: string;
}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = value === "MANUAL" ? "GTM" : "MANUAL";
    onChange(next);
    document.getElementById(tabId(next))?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="How to install"
      className={cn("inline-flex w-fit max-w-full gap-1 rounded-lg bg-[#F3F4F6] p-1", className)}
    >
      {METHODS.map((method) => {
        const selected = method.value === value;
        return (
          <button
            key={method.value}
            id={tabId(method.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={selected ? PANEL_ID : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(method.value)}
            onKeyDown={onKeyDown}
            className={cn(
              "h-[30px] cursor-pointer rounded-md border-0 px-3 text-[13px] whitespace-nowrap disabled:cursor-default disabled:opacity-45",
              selected
                ? "bg-white font-semibold shadow-[0_1px_2px_#11182714]"
                : "bg-transparent font-medium text-[#4B5563] hover:enabled:text-[#111827]",
              focusRing,
            )}
            style={selected ? { color: ACCENT_INK } : undefined}
          >
            {method.label}
          </button>
        );
      })}
    </div>
  );
}

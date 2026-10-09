"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

const SEG_LIGHT_SIZE = {
  xs: "h-7 px-2.5 text-xs",
  sm: "h-8 px-3 text-[13px]",
  md: "h-[34px] px-3 text-[13px]",
} as const;

/**
 * Segmented control in four treatments: `light` (separate buttons, navy when on), `joined` (one
 * bordered strip), `dark` (on the navy editor/preview bars) and `pill` (a grey track with a
 * raised white tab — the dashboard's experiment filter). Single-select, so
 * it is a radio group — or a tab list (`role="tab"`) when it switches what a panel shows.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  variant = "light",
  size = "md",
  disabled = false,
  role = "radio",
  className,
  itemClassName,
  ariaLabel,
  ariaLabelledby,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: "light" | "joined" | "dark" | "pill";
  /** Light variant only: 28px (xs), 32px (sm) or 34px (md) tall. */
  size?: keyof typeof SEG_LIGHT_SIZE;
  disabled?: boolean;
  role?: "radio" | "tab";
  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
}) {
  return (
    <div
      role={role === "tab" ? "tablist" : "radiogroup"}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className={cn(
        "flex",
        variant === "light" && "flex-wrap gap-1.5",
        variant === "joined" && "w-fit overflow-hidden rounded-lg border border-input",
        variant === "dark" && "w-fit gap-0.5 rounded-lg bg-white/8 p-[3px]",
        variant === "pill" &&
          "w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg bg-secondary p-[3px]",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={role}
            aria-checked={role === "radio" ? on : undefined}
            aria-selected={role === "tab" ? on : undefined}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "cursor-pointer font-bold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-primary/30 disabled:cursor-not-allowed",
              variant === "light" &&
                cn(
                  "rounded-md border disabled:opacity-50",
                  SEG_LIGHT_SIZE[size],
                  on
                    ? "border-navy bg-navy text-white"
                    : "border-input bg-card text-foreground hover:bg-muted",
                ),
              variant === "joined" &&
                cn(
                  "h-8 border-0 px-3 text-[12.5px] focus-visible:ring-inset disabled:opacity-50",
                  on ? "bg-navy text-white" : "bg-card text-foreground hover:bg-muted",
                ),
              variant === "dark" &&
                cn(
                  "h-[30px] rounded-md px-3 text-[12.5px]",
                  on ? "bg-white text-foreground" : "bg-transparent text-white/78 hover:text-white",
                ),
              variant === "pill" &&
                cn(
                  "flex h-[30px] shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] disabled:opacity-50",
                  on
                    ? "bg-card text-foreground shadow-[0_1px_2px_rgba(10,22,51,0.12)]"
                    : "bg-transparent text-ink-3 hover:text-foreground",
                ),
              itemClassName,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 38×22 switch. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 cursor-pointer rounded-[20px] border-0 p-0 outline-none focus-visible:ring-3 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-[#CBD1DC]",
        className,
      )}
    >
      <span
        className="absolute top-[3px] left-[3px] size-4 rounded-full bg-white transition-transform"
        style={{ transform: `translateX(${checked ? 16 : 0}px)` }}
      />
    </button>
  );
}

/** Round radio dot used inside radio cards. */
export function RadioDot({
  on,
  size = 16,
  className,
}: {
  on: boolean;
  size?: 16 | 18;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-full border-2", className)}
      style={{
        width: size,
        height: size,
        borderColor: on ? "#2B59F0" : "#CBD1DC",
        background: on ? "#2B59F0" : "#FFFFFF",
        boxShadow: "inset 0 0 0 3px #FFFFFF",
      }}
    />
  );
}

/**
 * Selectable card, the design's `sel(on)`: blue 1.5px border on the tint, plus the 3px focus-blue
 * ring (wizard cards) unless `ring={false}` (the cards inside modals). Lay out the content with
 * `className` — padding and flex direction vary per use.
 */
export function RadioCard({
  selected,
  onSelect,
  children,
  className,
  disabled,
  ariaLabel,
  ring = true,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ring?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "w-full cursor-pointer rounded-lg border-[1.5px] p-4 text-left text-foreground outline-none focus-visible:ring-3 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? cn("border-brand bg-brand-tint", ring && "shadow-[0_0_0_3px_rgba(43,89,240,0.14)]")
          : "border-border bg-card hover:border-[#C9D4F7]",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Checkbox chip (devices, countries). */
export function CheckChip({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-md border pr-3 pl-2 text-[13px] font-bold outline-none focus-visible:ring-3 focus-visible:ring-primary/30",
        checked ? "border-brand bg-brand-tint text-[#1F3FB0]" : "border-input bg-card text-ink-3",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-4 place-items-center rounded border-[1.5px] text-[11px] text-white",
          checked ? "border-brand bg-brand" : "border-[#CBD1DC] bg-white",
        )}
      >
        {checked ? "✓" : ""}
      </span>
      {children}
    </button>
  );
}

/** Square 20px checkbox with its label, one button (launch confirmation, design L1972). */
export function CheckBox({
  checked,
  onChange,
  children,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-[13.5px] font-bold text-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-[5px] border-[1.5px] text-xs text-white",
          checked ? "border-brand bg-brand" : "border-[#CBD1DC] bg-white",
        )}
      >
        {checked ? "✓" : ""}
      </span>
      {children}
    </button>
  );
}

/** Removable chip (selected countries). */
export function RemovableChip({
  children,
  onRemove,
  label,
}: {
  children: ReactNode;
  onRemove: () => void;
  label: string;
}) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-brand-tint-2 pr-1.5 pl-2.5 text-[12.5px] font-bold text-[#1F3FB0]">
      {children}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="cursor-pointer border-0 bg-transparent text-sm leading-none text-[#1F3FB0]"
      >
        ×
      </button>
    </span>
  );
}

/** Rounded pill toggle (secondary goals): "✓ name" / "+ name". */
export function PillToggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-[30px] cursor-pointer rounded-[20px] border px-2.5 text-[12.5px] font-bold outline-none focus-visible:ring-3 focus-visible:ring-primary/30",
        on
          ? "border-navy bg-navy text-white"
          : "border-input bg-card text-foreground hover:bg-muted",
      )}
    >
      {on ? "✓ " : "+ "}
      {children}
    </button>
  );
}

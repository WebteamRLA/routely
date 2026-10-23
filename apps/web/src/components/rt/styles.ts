/**
 * Class strings for the design system the Routely screens are built from (the "rt" prototype).
 *
 * The design specifies exact pixel values rather than a token scale, so these are Tailwind
 * arbitrary values copied from the reference. They live here once so the nine screens cannot
 * drift apart on, say, the primary button's hover or the focus ring.
 */

export const ACCENT = "#0070C9";
export const ACCENT_TINT = "#E6F4FF";
export const ACCENT_WASH = "#F0F7FF";
export const ACCENT_INK = "#0060AD";
export const ACCENT_LINE = "#B3DBFF";

export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";

const btnBase = `inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] no-underline disabled:cursor-default disabled:opacity-45 ${focusRing}`;

/** 36px buttons; add `h-11` (or `max-[641px]:h-11`) where the design grows them to 44px. */
export const btn = {
  primary: `${btnBase} h-9 border-0 bg-[#0070C9] px-4 font-semibold text-white shadow-[0_1px_2px_#11182714] hover:enabled:brightness-[.8] [a&]:hover:brightness-[.8]`,
  secondary: `${btnBase} h-9 border border-[#E5E7EB] bg-white px-3.5 font-medium text-[#374151] hover:enabled:bg-[#F9FAFB] [a&]:hover:bg-[#F9FAFB]`,
  danger: `${btnBase} h-9 border-0 bg-[#B91C1C] px-4 font-medium text-white hover:enabled:brightness-[.8]`,
  dangerOutline: `${btnBase} h-9 border border-[#FECACA] bg-white px-3.5 font-medium text-[#B91C1C] hover:enabled:bg-[#FEF2F2]`,
  /** Borderless text action, e.g. "I’ll set this up later". */
  link: `${btnBase} h-9 border-0 bg-transparent px-1 font-medium text-[#4B5563] hover:enabled:text-[#111827] [a&]:hover:text-[#111827]`,
  /** Square icon button with the inset-shadow hover the design uses on chrome. */
  icon: `inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-[#6B7280] hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] disabled:cursor-default disabled:opacity-45 ${focusRing}`,
};

/** 40px text input. `aria-invalid="true"` turns the border and ring red. */
export const input =
  "h-10 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] disabled:opacity-60 aria-[invalid=true]:border-[#DC2626] aria-[invalid=true]:focus:shadow-[0_0_0_3px_rgba(220,38,38,.12)]";

export const label = "text-[13px] font-medium text-[#374151]";
export const help = "m-0 text-[13px] leading-[19px] text-[#6B7280]";
export const errorText = "m-0 text-[13px] leading-[19px] text-[#B91C1C]";

/** White card with the design's hairline border. */
export const card = "rounded-xl border border-[#EEF0F3] bg-white";

/** The overlay menu surface shared by row menus, split buttons and filters. */
export const menuSurface =
  "z-[41] animate-[rt-in_.14s_ease-out] rounded-xl border border-[#E5E7EB] bg-white p-1.5 text-left shadow-[0_12px_32px_#11182724]";
export const menuItem = `flex min-h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-white px-2.5 text-left text-[13px] font-medium text-[#374151] no-underline hover:bg-[#F3F4F6] focus-visible:bg-[#F3F4F6] outline-none`;

export const mono = "font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

/** Page header: eyebrow / h1 / description, as on every top-level screen. */
export const pageTitle = "m-0 text-xl leading-7 font-semibold tracking-[-0.01em] text-[#111827]";
export const pageEyebrow = "text-[13px] leading-[18px] font-medium text-[#6B7280]";
export const pageDescription = "m-0 text-sm leading-[22px] text-pretty text-[#4B5563]";

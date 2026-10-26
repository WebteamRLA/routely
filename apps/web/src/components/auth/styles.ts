import { cn } from "@/lib/utils";

/** The sign-in screens' focus ring and inline text link — shared by the account and legal pages. */
export const authFocusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";

export const authTextLink = cn(
  "cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#374151] underline decoration-[#D1D5DB] underline-offset-2 hover:text-[#111827] hover:decoration-[#111827]",
  authFocusRing,
);

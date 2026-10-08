import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/*
 * The design's buttons: 6px radius, bold 13.5px label, 38px tall by default. Primary is the
 * brand blue (#2B59F0 → #1F45C9 on hover); outline is white on the #D5DAE4 input border;
 * `dark` is the navy used for Retry/Try again; destructive is solid red for confirmations.
 * Focus draws the design's 3px rgba(43,89,240,0.15) ring.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-clip-padding text-[13.5px] font-bold whitespace-nowrap no-underline transition-colors outline-none select-none hover:no-underline focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:border-brand-hover hover:bg-brand-hover",
        outline:
          "border-input bg-card text-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[#E4E7EE] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "text-ink-2 hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground",
        dark: "border-navy bg-navy text-white hover:bg-[#16244A]",
        success: "border-success bg-success text-white hover:border-[#0F8A5C] hover:bg-[#0F8A5C]",
        destructive:
          "border-danger bg-danger text-white hover:border-[#B83030] hover:bg-[#B83030] focus-visible:border-danger focus-visible:ring-danger/20",
        "destructive-outline":
          "border-input bg-card text-danger-text hover:border-danger-border hover:bg-danger-bg",
        link: "h-auto! border-0 px-0! text-primary underline-offset-4 hover:text-brand-hover hover:underline",
      },
      size: {
        default:
          "h-[38px] gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 text-[13px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-4 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-[38px]",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

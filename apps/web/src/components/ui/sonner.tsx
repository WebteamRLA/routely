"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toast host, mounted once in the root layout.
 *
 * The design's toast: navy, bottom-centre, a rotated coral diamond before the text, gone after
 * 2.8s. The diamond is drawn by the toast itself (`::before`) rather than as sonner's icon, so a
 * plain `toast("…")` carries it too; errors turn it red so the difference does not rest on
 * reading alone.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      duration={2800}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-2.5 rounded-lg bg-navy px-[18px] py-3 text-[13.5px] font-bold text-white shadow-[0_12px_30px_rgba(10,22,51,0.3)] before:size-[7px] before:shrink-0 before:rotate-45 before:bg-coral before:content-[''] data-[type=error]:before:bg-[#FF7A66] data-[type=warning]:before:bg-[#F5B544]",
          title: "font-bold",
          description: "text-[12.5px] font-medium text-white/70",
          icon: "hidden",
          actionButton:
            "ml-auto h-7 shrink-0 cursor-pointer rounded-md bg-primary px-2.5 text-xs font-bold text-white",
          cancelButton:
            "h-7 shrink-0 cursor-pointer rounded-md bg-white/10 px-2.5 text-xs font-bold text-white",
        },
      }}
      {...props}
    />
  );
}

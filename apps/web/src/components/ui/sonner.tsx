"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** The design's toast marker: a small rotated square, coral for news and red-tinted for errors. */
function Diamond({ className }: { className: string }) {
  return <span aria-hidden className={`block size-[7px] shrink-0 rotate-45 ${className}`} />;
}

/**
 * Toast host, mounted once in the root layout.
 *
 * The design's toast: navy, bottom-centre, a coral diamond in place of an icon, gone after 2.8s.
 * Errors keep the same surface — the wording carries the meaning, and the diamond turns red so
 * the difference does not rest on reading alone.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      duration={2800}
      icons={{
        success: <Diamond className="bg-coral" />,
        info: <Diamond className="bg-coral" />,
        warning: <Diamond className="bg-[#F5B544]" />,
        error: <Diamond className="bg-[#FF7A66]" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-2.5 rounded-lg bg-navy px-[18px] py-3 text-[13.5px] font-bold text-white shadow-[0_12px_30px_rgba(10,22,51,0.3)]",
          title: "font-bold",
          description: "text-[12.5px] font-medium text-white/70",
          icon: "flex size-auto items-center",
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

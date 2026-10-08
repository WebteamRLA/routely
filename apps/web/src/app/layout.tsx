import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Manrope, Sora } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import "./globals.css";

// The design's three faces: Sora for headings and figures, Manrope for UI text, JetBrains Mono
// for URLs, code and event keys. Mapped to Tailwind's `font-heading`/`font-sans`/`font-mono`
// in globals.css.
const sora = Sora({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-sora" });
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Routely",
    template: "%s · Routely",
  },
  description:
    "Compare two versions of a page with redirect experiments and measure which one converts.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "font-sans antialiased",
          sora.variable,
          manrope.variable,
          jetbrainsMono.variable,
        )}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

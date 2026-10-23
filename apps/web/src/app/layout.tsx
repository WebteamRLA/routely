import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import "./globals.css";

// Inter is the design's typeface everywhere — sign-in included — so it is the app's `--font-sans`
// rather than a variable one subtree opts into. Dialogs and toasts portal to <body>, outside any
// subtree, and would otherwise fall back to a different face.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

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
      <body className={cn("font-sans antialiased", inter.variable, geistMono.variable)}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}

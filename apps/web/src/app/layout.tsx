import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import Script from "next/script";

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

// Routely's own Google Tag Manager container (our analytics, not a customer's — those install
// the SDK through `lib/gtm.ts`). Production builds only, so local development sends nothing.
const GTM_ID = "GTM-N9NQCT76";
const loadGtm = process.env.NODE_ENV === "production";

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
        {loadGtm ? (
          <>
            <Script id="gtm-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());`}
            </Script>
            <Script
              id="gtm"
              strategy="afterInteractive"
              src={`https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`}
            />
          </>
        ) : null}
      </body>
    </html>
  );
}

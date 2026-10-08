import type { InstallMethodKey } from "@/lib/domain";

/** Everything the installation panel/modal needs. Plain data — safe to pass to client components. */
export interface InstallInfo {
  projectId: string;
  publicSiteId: string;
  /** The full snippet to paste into <head> (anti-flicker block + tracking tag). */
  snippet: string;
  /** The same loader wrapped for a Google Tag Manager Custom HTML tag. */
  gtmSnippet: string;
  method: InstallMethodKey;
  /** Snippet seen on a page, or tracking data has arrived. */
  installed: boolean;
  pixelVerifiedAt: string | null;
  receivingData: boolean;
  protocol: "https" | "http";
  /** Primary first. */
  domains: string[];
}

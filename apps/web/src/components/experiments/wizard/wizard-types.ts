import type { PrimaryMetric, SiteProtocol, UrlMatchType } from "@/generated/prisma/enums";

export interface WizardWebsite {
  id: string;
  name: string;
  domain: string;
  protocol: SiteProtocol;
  /** Carried so the summary's failed install check can open the setup guide in place. */
  publicSiteId: string;
}

/** The subset of an active experiment the summary step's conflict check needs. */
export interface WizardActiveExperiment {
  id: string;
  name: string;
  websiteId: string;
  controlUrl: string;
  controlMatchType: UrlMatchType;
}

/** One redirect target row in the wizard's dynamic list. `id` is present only when editing an
 * existing variant — its absence is what tells the service "create this one" apart from
 * "update this one". */
export interface WizardVariant {
  id?: string;
  url: string;
  /** Relative share of the included traffic. See `Experiment.controlWeight` in the schema. */
  weight: number;
}

export interface WizardValues {
  websiteId: string;
  name: string;
  description: string;
  controlUrl: string;
  controlMatchType: UrlMatchType;
  controlWeight: number;
  variants: WizardVariant[];
  conversionUrl: string;
  conversionMatchType: UrlMatchType;
  primaryMetric: PrimaryMetric;
  trafficAllocation: number;
}

export const PRIMARY_METRIC_LABEL: Record<PrimaryMetric, string> = {
  CONVERSION_RATE: "Conversion rate",
  TIME_ON_PAGE: "Average time on page",
  PAGE_VIEWS: "Page views per visitor",
};

/**
 * Arm colours by position — arm 0 is always control. Fixed per position so an arm keeps its
 * colour as the set changes; a fifth variant and beyond cycle through the variant colours.
 */
const VARIANT_ARM_CLASSES = ["bg-arm-a", "bg-arm-b", "bg-arm-c", "bg-arm-d"];

export function armColorClass(armIndex: number): string {
  if (armIndex <= 0) return "bg-arm-control";
  return VARIANT_ARM_CLASSES[(armIndex - 1) % VARIANT_ARM_CLASSES.length]!;
}

/**
 * The path part of a URL for compact display (`/pricing?x=1`), falling back to whatever was
 * typed when it does not parse yet — the rail and the review update while the customer types.
 */
export function displayPath(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return trimmed;
  }
}

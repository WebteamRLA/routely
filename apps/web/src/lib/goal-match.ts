import { urlMatches } from "@/lib/url";

/**
 * Which metrics a received event hits, and which experiment goals it meets.
 *
 * Pure, so ingestion's matching rules are unit-tested: `ingest.service.ts` loads the project's
 * metrics and the visitor's assignments and asks these functions what to record.
 *
 * Two kinds of site-level event arrive from the SDK:
 *  - `page` — a page view on any page. Hits the system `page_view` metric and every page-visit
 *    metric whose URL it matches; meets a URL goal on its configured conversion URL.
 *  - `track` — `routely.track(key)`. Hits the custom-event metric with that key.
 * A goal that is a metric is met when the event hits that metric.
 */

type MatchType = "EXACT" | "PREFIX";

/** The URL goal's key in `Conversion.goalKey` / `Event.goalKey`; metric goals use the metric id. */
export const URL_GOAL_KEY = "url";

/** The system metric every page view hits. */
export const PAGE_VIEW_METRIC_KEY = "page_view";

export interface MetricDef {
  id: string;
  kind: "CUSTOM_EVENT" | "PAGE_VISIT";
  key: string;
  url: string | null;
  matchType: MatchType;
  system: boolean;
}

export interface GoalExperiment {
  /** Null means the URL goal (`conversionUrl`) is primary. */
  goalMetricId: string | null;
  conversionUrl: string | null;
  conversionMatchType: MatchType;
  secondaryMetricIds: string[];
}

export type SiteEvent = { type: "page"; url: string } | { type: "track"; key: string };

/** Metrics an event hits. */
export function metricsHit(event: SiteEvent, metrics: MetricDef[]): MetricDef[] {
  if (event.type === "track") {
    return metrics.filter((metric) => metric.kind === "CUSTOM_EVENT" && metric.key === event.key);
  }
  return metrics.filter((metric) => {
    if (metric.system && metric.key === PAGE_VIEW_METRIC_KEY) return true;
    return (
      metric.kind === "PAGE_VISIT" &&
      metric.url !== null &&
      urlMatches(event.url, metric.url, metric.matchType)
    );
  });
}

/** Every goal key an experiment counts conversions for: its primary, then its secondaries. */
export function goalKeys(experiment: GoalExperiment): string[] {
  const keys: string[] = [];
  if (experiment.goalMetricId === null) {
    if (experiment.conversionUrl) keys.push(URL_GOAL_KEY);
  } else {
    keys.push(experiment.goalMetricId);
  }
  for (const id of experiment.secondaryMetricIds) if (!keys.includes(id)) keys.push(id);
  return keys;
}

/**
 * The goals of one experiment this event meets, given the metrics it hit.
 *
 * The URL goal is met only by a `page` event on the configured conversion URL — normalised and
 * matched exactly as before, so a trailing slash or a campaign parameter does not matter and a
 * PREFIX goal still needs a path boundary.
 */
export function goalsMet(
  experiment: GoalExperiment,
  event: SiteEvent,
  hitMetricIds: ReadonlySet<string>,
): string[] {
  return goalKeys(experiment).filter((key) => {
    if (key !== URL_GOAL_KEY) return hitMetricIds.has(key);
    return (
      event.type === "page" &&
      experiment.conversionUrl !== null &&
      urlMatches(event.url, experiment.conversionUrl, experiment.conversionMatchType)
    );
  });
}

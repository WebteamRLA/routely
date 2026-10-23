/**
 * The Integrations catalog's `?view=` states and static group copy, from the design's
 * `Integrations` screen.
 *
 * Lives outside the `"use client"` view so the server page can read `INTEGRATIONS_VIEWS`. The card's
 * data is real (`getIntegrationsCard`); only `catalogConnecting` — the moment between pressing
 * "Connect email" and the browser leaving for Google — is a purely visual state. `catalog` and
 * `catalogNotConnected` are kept as names so old links still resolve; they now render real data.
 */

export const INTEGRATIONS_VIEWS = ["catalog", "catalogNotConnected", "catalogConnecting"] as const;
export type IntegrationsViewName = (typeof INTEGRATIONS_VIEWS)[number];

export const REPORTING_GROUP = {
  id: "int-reporting",
  label: "Reporting",
  desc: "Send experiment results to the tools your clients and team read.",
};

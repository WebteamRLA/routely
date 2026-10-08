import type { LegacyExperimentConfig, LiveExperimentConfig } from "../src/contract";

/**
 * Converts a protocol-v3 experiment fixture into the v4 shape the SDK now consumes.
 *
 * The suites written against v3 express their cases as `control` / `variants` / `controlWeight`;
 * v4 carries the same information as one positioned `arms` list plus a page rule. Converting at
 * the call site keeps every original case — and its assertion — exactly as it was, so the suites
 * prove the v4 code behaves as v3 did. The uppercase match modes are the legacy, normalised-URL
 * rules, which is what an experiment with no stored targeting is served with.
 */
export function v4(legacy: LegacyExperimentConfig): LiveExperimentConfig {
  return {
    id: legacy.id,
    type: "redirect",
    targeting: {
      match: legacy.control.match,
      pattern: legacy.control.url,
      audience: "all",
      devices: ["desktop", "tablet", "mobile"],
      logic: "all",
      conditions: [],
    },
    coverage: legacy.trafficAllocation,
    arms: [
      { position: 0, variantId: null, weight: legacy.controlWeight, url: legacy.control.url },
      ...legacy.variants.map((variant, index) => ({
        position: index + 1,
        variantId: variant.id,
        weight: variant.weight,
        url: variant.url,
      })),
    ],
  };
}

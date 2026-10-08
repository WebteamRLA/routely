import { describe, expect, it } from "vitest";

import {
  assignmentKey,
  drawArm,
  readAssignment,
  resolveAssignment,
  writeAssignment,
} from "../src/assignment";
import type { LegacyExperimentConfig as ExperimentConfig } from "../src/contract";
import { createMemoryStore } from "../src/env";
import { v4 } from "./fixtures";

const VARIANT_ID = "var_1";

const EXPERIMENT: ExperimentConfig = {
  id: "exp_1",
  control: { url: "https://acme.test/pricing", match: "EXACT" },
  controlWeight: 50,
  variants: [{ id: VARIANT_ID, url: "https://acme.test/pricing-v2", weight: 50 }],
  goal: { url: "https://acme.test/thanks", match: "EXACT" },
  trafficAllocation: 100,
};

/** A deterministic source of "randomness", so a draw can be aimed at any arm. */
const fixed = (value: number) => () => value;

describe("drawArm", () => {
  it("respects the boundary between control and one variant", () => {
    // Control holds the lower half of the range, the one variant the upper half.
    expect(drawArm(50, EXPERIMENT.variants, fixed(0.49))).toBeNull();
    expect(drawArm(50, EXPERIMENT.variants, fixed(0.5))).toBe(VARIANT_ID);
    expect(drawArm(50, EXPERIMENT.variants, fixed(0.99))).toBe(VARIANT_ID);
  });

  it("splits evenly when every arm carries the same weight", () => {
    const variants = [
      { id: "var_1", url: "https://acme.test/v1", weight: 50 },
      { id: "var_2", url: "https://acme.test/v2", weight: 50 },
    ];
    // 3 equally-weighted arms: each occupies one third of the range.
    expect(drawArm(50, variants, fixed(0.1))).toBeNull();
    expect(drawArm(50, variants, fixed(0.4))).toBe("var_1");
    expect(drawArm(50, variants, fixed(0.7))).toBe("var_2");
  });

  it("honours an uneven split", () => {
    const variants = [{ id: "var_1", url: "https://acme.test/v1", weight: 80 }];
    // 20/80: control owns only the first fifth of the range.
    expect(drawArm(20, variants, fixed(0.19))).toBeNull();
    expect(drawArm(20, variants, fixed(0.21))).toBe("var_1");
  });

  it("treats weights as relative, not as percentages", () => {
    // 1:1 must behave exactly like 50:50 — nothing requires weights to add up to 100.
    const variants = [{ id: "var_1", url: "https://acme.test/v1", weight: 1 }];
    expect(drawArm(1, variants, fixed(0.49))).toBeNull();
    expect(drawArm(1, variants, fixed(0.51))).toBe("var_1");
  });

  it("never draws an arm parked at zero", () => {
    const variants = [
      { id: "var_1", url: "https://acme.test/v1", weight: 0 },
      { id: "var_2", url: "https://acme.test/v2", weight: 50 },
    ];
    for (const roll of [0.5, 0.6, 0.75, 0.9, 0.999]) {
      expect(drawArm(50, variants, fixed(roll))).not.toBe("var_1");
    }
    // …and control at zero is skipped just the same.
    expect(drawArm(0, [{ id: "var_1", url: "https://acme.test/v1", weight: 10 }], fixed(0))).toBe(
      "var_1",
    );
  });

  it("falls back to control rather than throwing when every arm is parked", () => {
    // Rejected by validation server-side, but a tracking script must not throw on a config it
    // somehow received anyway.
    expect(
      drawArm(0, [{ id: "var_1", url: "https://acme.test/v1", weight: 0 }], fixed(0.5)),
    ).toBeNull();
  });

  it("ignores a non-finite or negative weight instead of corrupting the range", () => {
    const variants = [
      { id: "var_1", url: "https://acme.test/v1", weight: Number.NaN },
      { id: "var_2", url: "https://acme.test/v2", weight: -10 },
      { id: "var_3", url: "https://acme.test/v3", weight: 50 },
    ];
    // Only control and var_3 carry usable weight, so this is an even two-way split.
    expect(drawArm(50, variants, fixed(0.25))).toBeNull();
    expect(drawArm(50, variants, fixed(0.75))).toBe("var_3");
  });

  it("stays inside the last arm for a random source that returns exactly 1", () => {
    expect(drawArm(50, EXPERIMENT.variants, fixed(1))).toBe(VARIANT_ID);
  });
});

describe("distribution", () => {
  it("is approximately balanced across many new visitors, one variant", () => {
    const trials = 20_000;
    let variant = 0;

    for (let i = 0; i < trials; i += 1) {
      // Each iteration is a distinct new visitor: a fresh store means no prior assignment.
      const store = [createMemoryStore()];
      if (resolveAssignment(v4(EXPERIMENT), store).variantId !== null) variant += 1;
    }

    const share = variant / trials;
    // ±2 points. A true 50/50 over 20k draws has a standard deviation of ~0.35 points, so
    // this is ~5.7σ — tight enough to catch a real bias, loose enough not to flake.
    expect(share).toBeGreaterThan(0.48);
    expect(share).toBeLessThan(0.52);
  });

  it("is approximately balanced across control and two variants", () => {
    const trials = 30_000;
    const experiment: ExperimentConfig = {
      ...EXPERIMENT,
      controlWeight: 50,
      variants: [
        { id: "var_1", url: "https://acme.test/v1", weight: 50 },
        { id: "var_2", url: "https://acme.test/v2", weight: 50 },
      ],
    };
    const counts = { control: 0, var_1: 0, var_2: 0 };

    for (let i = 0; i < trials; i += 1) {
      const store = [createMemoryStore()];
      const { variantId } = resolveAssignment(v4(experiment), store);
      counts[variantId === null ? "control" : (variantId as "var_1" | "var_2")] += 1;
    }

    // Each of the 3 arms should land near 1/3 — ±2.5 points is comfortably outside noise for
    // 30k trials (σ ≈ 0.27 points).
    for (const share of [counts.control / trials, counts.var_1 / trials, counts.var_2 / trials]) {
      expect(share).toBeGreaterThan(0.308);
      expect(share).toBeLessThan(0.358);
    }
  });

  it("follows an uneven weighting over many visitors", () => {
    const trials = 30_000;
    const experiment: ExperimentConfig = {
      ...EXPERIMENT,
      controlWeight: 20,
      variants: [{ id: "var_1", url: "https://acme.test/v1", weight: 80 }],
    };
    let control = 0;

    for (let i = 0; i < trials; i += 1) {
      const store = [createMemoryStore()];
      if (resolveAssignment(v4(experiment), store).variantId === null) control += 1;
    }

    // 20/80 — σ ≈ 0.23 points over 30k draws, so ±2 points is far outside noise.
    const share = control / trials;
    expect(share).toBeGreaterThan(0.18);
    expect(share).toBeLessThan(0.22);
  });
});

describe("assignment consistency", () => {
  it("does not re-randomise on a repeat visit", () => {
    const stores = [createMemoryStore()];
    const first = resolveAssignment(v4(EXPERIMENT), stores);

    // Draws are forced to the *opposite* arm; a stored assignment must win regardless.
    const opposite = first.variantId !== null ? fixed(0.99) : fixed(0.01);

    for (let i = 0; i < 50; i += 1) {
      const again = resolveAssignment(v4(EXPERIMENT), stores, { random: opposite });
      expect(again.variantId).toBe(first.variantId);
      expect(again.isNew).toBe(false);
    }
  });

  it("keeps separate experiments independent", () => {
    const stores = [createMemoryStore()];
    resolveAssignment(v4(EXPERIMENT), stores, { random: fixed(0.9) });
    resolveAssignment(v4({ ...EXPERIMENT, id: "exp_2" }), stores, { random: fixed(0.1) });

    expect(readAssignment("exp_1", stores)?.variantId).toBe(VARIANT_ID);
    expect(readAssignment("exp_2", stores)?.variantId).toBeNull();
    expect(assignmentKey("exp_1")).not.toBe(assignmentKey("exp_2"));
  });

  it("applies a handed-over decision only when nothing is stored", () => {
    const fresh = [createMemoryStore()];
    expect(resolveAssignment(v4(EXPERIMENT), fresh, { forced: VARIANT_ID }).variantId).toBe(
      VARIANT_ID,
    );

    // An existing assignment must not be overwritten by a value from a query string.
    const existing = [createMemoryStore()];
    resolveAssignment(v4(EXPERIMENT), existing, { random: fixed(0.01) }); // control
    expect(
      resolveAssignment(v4(EXPERIMENT), existing, { forced: VARIANT_ID }).variantId,
    ).toBeNull();
  });

  it("distinguishes `forced: null` (forced to control) from omitting `forced` entirely", () => {
    // `null` is itself meaningful now — unlike the old model, it can't share a sentinel with
    // "no forced value" the way falsy values could when control had no id of its own.
    const store = [createMemoryStore()];
    expect(resolveAssignment(v4(EXPERIMENT), store, { forced: null }).variantId).toBeNull();
  });

  it("re-draws when the stored value is corrupted", () => {
    const store = createMemoryStore();
    store.setItem(assignmentKey(EXPERIMENT.id), "{not json");

    const result = resolveAssignment(v4(EXPERIMENT), [store], { random: fixed(0.9) });
    expect(result.variantId).toBe(VARIANT_ID);
    expect(result.isNew).toBe(true);
  });

  it("ignores a stored value whose variantId is the wrong type", () => {
    const store = createMemoryStore();
    store.setItem(assignmentKey(EXPERIMENT.id), JSON.stringify({ variantId: 12345 }));

    expect(
      resolveAssignment(v4(EXPERIMENT), [store], { random: fixed(0.01) }).variantId,
    ).toBeNull();
  });

  it("survives a page refresh, which reads the same store again", () => {
    const store = createMemoryStore();
    const first = resolveAssignment(v4(EXPERIMENT), [store]);

    // A refresh: new arrays, same underlying storage.
    for (let i = 0; i < 5; i += 1) {
      expect(resolveAssignment(v4(EXPERIMENT), [store]).variantId).toBe(first.variantId);
    }
  });

  it("writes to every store so one being cleared does not re-bucket the visitor", () => {
    const local = createMemoryStore();
    const memory = createMemoryStore();
    const first = resolveAssignment(v4(EXPERIMENT), [local, memory]);

    local.removeItem(assignmentKey(EXPERIMENT.id));

    expect(resolveAssignment(v4(EXPERIMENT), [local, memory]).variantId).toBe(first.variantId);
  });

  it("marks an assignment as reported without changing the arm", () => {
    const stores = [createMemoryStore()];
    const first = resolveAssignment(v4(EXPERIMENT), stores);

    writeAssignment(EXPERIMENT.id, { variantId: first.variantId, at: 0, sent: true }, stores);

    expect(readAssignment(EXPERIMENT.id, stores)?.sent).toBe(true);
    expect(readAssignment(EXPERIMENT.id, stores)?.variantId).toBe(first.variantId);
  });
});

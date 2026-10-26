import { describe, expect, it } from "vitest";

import {
  type AllocatableExperiment,
  type AssignmentLedger,
  assignVisitor,
  pickBalancedArm,
} from "@/lib/balance";

/**
 * An in-memory ledger with the same contract as the Postgres one: rows unique per visitor, and
 * `serialised` a real mutex (or, with `locked: false`, none — to show what the lock is for). Every
 * read yields to the event loop first, so concurrent callers interleave the way requests do.
 */
function memoryLedger({ locked = true } = {}) {
  const rows = new Map<string, Map<string, string | null>>();
  let tail: Promise<unknown> = Promise.resolve();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const ledger: AssignmentLedger = {
    serialised(experimentId, fn) {
      const table = rows.get(experimentId) ?? new Map<string, string | null>();
      rows.set(experimentId, table);
      const run = () =>
        fn({
          async existing(visitorId) {
            await tick();
            return table.has(visitorId) ? { variantId: table.get(visitorId)! } : undefined;
          },
          async counts() {
            await tick();
            const counts = new Map<string | null, number>();
            for (const arm of table.values()) counts.set(arm, (counts.get(arm) ?? 0) + 1);
            return counts;
          },
          async create(visitorId, variantId) {
            await tick();
            // The unique constraint on (experimentId, visitorId).
            if (table.has(visitorId)) throw new Error("unique violation");
            table.set(visitorId, variantId);
          },
        });
      if (!locked) return run();
      const result = tail.then(run, run);
      tail = result.catch(() => undefined);
      return result;
    },
  };

  const tally = (experimentId: string) => {
    const counts = new Map<string | null, number>();
    for (const arm of rows.get(experimentId)?.values() ?? []) {
      counts.set(arm, (counts.get(arm) ?? 0) + 1);
    }
    return counts;
  };
  return { ledger, tally, size: (experimentId: string) => rows.get(experimentId)?.size ?? 0 };
}

/** Control plus four variants, each at `weights[i]`. */
function experiment(weights: number[], id = "exp_1"): AllocatableExperiment {
  return {
    id,
    controlWeight: weights[0]!,
    variants: weights.slice(1).map((weight, i) => ({ id: `var_${i + 1}`, weight })),
  };
}

const ARMS = [null, "var_1", "var_2", "var_3", "var_4"];
const asList = (counts: Map<string | null, number>, arms = ARMS) =>
  arms.map((arm) => counts.get(arm) ?? 0);

/** A seeded generator, so a "random" run is the same run every time. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("pickBalancedArm", () => {
  it("gives the next visitor to the arm furthest below its share", () => {
    const arms = [
      { id: null, weight: 1, count: 3 },
      { id: "a", weight: 1, count: 1 },
      { id: "b", weight: 1, count: 2 },
    ];
    expect(pickBalancedArm(arms)).toBe("a");
  });

  it("breaks a tie at random, so the first visitor is not always control", () => {
    const empty = ARMS.map((id) => ({ id, weight: 20, count: 0 }));
    expect(pickBalancedArm(empty, () => 0)).toBeNull();
    expect(pickBalancedArm(empty, () => 0.99)).toBe("var_4");
    expect(pickBalancedArm(empty, () => 0.5)).toBe("var_2");
  });

  it("never picks an arm weighted 0, and falls back to control when nothing has weight", () => {
    const parked = [
      { id: null, weight: 50, count: 10 },
      { id: "a", weight: 0, count: 0 },
      { id: "b", weight: 50, count: 10 },
    ];
    for (let i = 0; i < 20; i++) expect(pickBalancedArm(parked, Math.random)).not.toBe("a");
    expect(pickBalancedArm([{ id: "a", weight: 0, count: 0 }])).toBeNull();
    expect(pickBalancedArm([{ id: "a", weight: Number.NaN, count: 0 }])).toBeNull();
  });
});

describe("assignVisitor", () => {
  it("splits 25 visitors across 5 equal versions exactly 5 each, never more than 1 apart", async () => {
    const { ledger, tally } = memoryLedger();
    const exp = experiment([20, 20, 20, 20, 20]);
    for (let i = 1; i <= 25; i++) {
      await assignVisitor(ledger, exp, `visitor_${i}`, seeded(i));
      const counts = asList(tally(exp.id));
      // At every step, not only at the end: an early read of the results sees a fair split.
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
    expect(asList(tally(exp.id))).toEqual([5, 5, 5, 5, 5]);
  });

  it("keeps 25 visitors arriving at once at exactly 5 each — the lock is what makes it so", async () => {
    const exp = experiment([20, 20, 20, 20, 20]);
    const visitors = Array.from({ length: 25 }, (_, i) => `visitor_${i + 1}`);

    const safe = memoryLedger();
    await Promise.all(visitors.map((id) => assignVisitor(safe.ledger, exp, id, () => 0)));
    expect(asList(safe.tally(exp.id))).toEqual([5, 5, 5, 5, 5]);

    // The same burst with no lock: every request reads the same empty counts and is owed the same
    // arm. This is the race the Postgres advisory lock exists to prevent.
    const unsafe = memoryLedger({ locked: false });
    await Promise.all(visitors.map((id) => assignVisitor(unsafe.ledger, exp, id, () => 0)));
    expect(asList(unsafe.tally(exp.id))).toEqual([25, 0, 0, 0, 0]);
  });

  it("keeps a returning visitor on their original version and adds no visitor", async () => {
    const { ledger, tally, size } = memoryLedger();
    const exp = experiment([20, 20, 20, 20, 20]);
    for (let i = 1; i <= 7; i++) await assignVisitor(ledger, exp, `visitor_${i}`, seeded(i));
    const before = asList(tally(exp.id));

    const first = await assignVisitor(ledger, exp, "visitor_3");
    for (let visit = 0; visit < 10; visit++) {
      const again = await assignVisitor(ledger, exp, "visitor_3", () => 0.99);
      expect(again).toEqual({ variantId: first.variantId, created: false });
    }
    expect(size(exp.id)).toBe(7);
    expect(asList(tally(exp.id))).toEqual(before);
  });

  it("does not count a refresh as a visitor, even many refreshes at once", async () => {
    const { ledger, size } = memoryLedger();
    const exp = experiment([20, 20, 20, 20, 20]);
    const original = await assignVisitor(ledger, exp, "visitor_1");

    // Ten tabs refreshing together: one row, one arm, every answer the same.
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => assignVisitor(ledger, exp, "visitor_1", () => 0.99)),
    );
    expect(new Set(answers.map((a) => a.variantId))).toEqual(new Set([original.variantId]));
    expect(answers.every((a) => !a.created)).toBe(true);
    expect(size(exp.id)).toBe(1);
  });

  it("follows an unequal split exactly where it divides, and within one visitor everywhere", async () => {
    const { ledger, tally } = memoryLedger();
    const weights = [50, 20, 10, 10, 10];
    const exp = experiment(weights);
    for (let n = 1; n <= 40; n++) {
      await assignVisitor(ledger, exp, `visitor_${n}`, seeded(n));
      const counts = asList(tally(exp.id));
      counts.forEach((count, arm) => {
        expect(Math.abs(count - (weights[arm]! / 100) * n)).toBeLessThan(1);
      });
      if (n === 10) expect(counts).toEqual([5, 2, 1, 1, 1]);
      if (n === 20) expect(counts).toEqual([10, 4, 2, 2, 2]);
    }
    expect(asList(tally(exp.id))).toEqual([20, 8, 4, 4, 4]);
  });

  it("respects other custom splits: 70/30, thirds, and a parked arm", async () => {
    const twoArms = memoryLedger();
    const seventy = { id: "exp_2", controlWeight: 70, variants: [{ id: "var_1", weight: 30 }] };
    for (let i = 1; i <= 10; i++) await assignVisitor(twoArms.ledger, seventy, `v${i}`, seeded(i));
    expect(asList(twoArms.tally("exp_2"), [null, "var_1"])).toEqual([7, 3]);

    const thirds = memoryLedger();
    const three = experiment([1, 1, 1], "exp_3");
    for (let i = 1; i <= 10; i++) await assignVisitor(thirds.ledger, three, `v${i}`, seeded(i));
    const counts = asList(thirds.tally("exp_3"), [null, "var_1", "var_2"]);
    expect(counts.reduce((a, b) => a + b)).toBe(10);
    expect(Math.max(...counts) - Math.min(...counts)).toBe(1); // 4/3/3 in some order

    const parked = memoryLedger();
    const withParked = experiment([50, 0, 50], "exp_4");
    for (let i = 1; i <= 12; i++)
      await assignVisitor(parked.ledger, withParked, `v${i}`, seeded(i));
    expect(asList(parked.tally("exp_4"), [null, "var_1", "var_2"])).toEqual([6, 0, 6]);
  });

  it("corrects an imbalance it did not cause, by owing the short arm the next visitors", async () => {
    const { ledger, tally } = memoryLedger();
    const exp = { id: "exp_5", controlWeight: 50, variants: [{ id: "var_1", weight: 50 }] };
    // Eight visitors already on control (say, from an older client that drew arms itself).
    for (let i = 1; i <= 8; i++) {
      await ledger.serialised(exp.id, (tx) => tx.create(`old_${i}`, null));
    }
    for (let i = 1; i <= 8; i++) await assignVisitor(ledger, exp, `new_${i}`, seeded(i));
    expect(asList(tally(exp.id), [null, "var_1"])).toEqual([8, 8]);
  });
});

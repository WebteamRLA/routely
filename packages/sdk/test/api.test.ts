import { describe, expect, it } from "vitest";

import { drainQueue, isTrackKey, runCommand } from "../src/api";

describe("track queue", () => {
  it("replays track commands queued before the bundle loaded", () => {
    const sent: unknown[] = [];
    const queue = [["track", "signup"], ["identify", "x"], ["track", "lead"], "junk", null];
    expect(drainQueue(queue, (key) => sent.push(key))).toBe(5);
    expect(sent).toEqual(["signup", "lead"]);
  });

  it("accepts an object carrying a `q` array", () => {
    const sent: unknown[] = [];
    drainQueue({ q: [["track", "purchase"]] }, (key) => sent.push(key));
    expect(sent).toEqual(["purchase"]);
  });

  it("leaves anything else alone — including another copy of the SDK's own state", () => {
    const sent: unknown[] = [];
    expect(drainQueue({ track: () => true, version: "0.2.0" }, (k) => sent.push(k))).toBe(0);
    expect(drainQueue(undefined, (k) => sent.push(k))).toBe(0);
    expect(drainQueue("routely", (k) => sent.push(k))).toBe(0);
    expect(sent).toEqual([]);
  });

  it("never throws for a hostile entry", () => {
    const hostile = {
      get 0() {
        throw new Error("boom");
      },
    };
    expect(() => runCommand(hostile, () => {})).not.toThrow();
  });

  it("validates keys before anything is sent", () => {
    expect(isTrackKey("demo_booked")).toBe(true);
    expect(isTrackKey("Checkout.Complete:v2")).toBe(true);
    for (const bad of ["", "has space", "x".repeat(65), 42, null, "<script>"]) {
      expect(isTrackKey(bad)).toBe(false);
    }
  });
});

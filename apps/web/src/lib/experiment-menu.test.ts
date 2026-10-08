import { describe, expect, it } from "vitest";

import { menuFor } from "./experiment-menu";

const keys = (s: Parameters<typeof menuFor>[0]) => menuFor(s).map((a) => a.key);

describe("menuFor", () => {
  it("offers the prototype's actions per status", () => {
    expect(keys("draft")).toEqual(["continue", "duplicate", "delete"]);
    expect(keys("running")).toEqual(["view", "pause", "duplicate"]);
    expect(keys("paused")).toEqual(["view", "resume", "duplicate"]);
    expect(keys("completed")).toEqual(["view", "duplicate", "delete"]);
  });

  it("labels and colours them", () => {
    expect(menuFor("draft")).toEqual([
      { key: "continue", label: "Continue setup", danger: false, color: "#0F1B35" },
      { key: "duplicate", label: "Duplicate", danger: false, color: "#0F1B35" },
      { key: "delete", label: "Delete", danger: true, color: "#B4361F" },
    ]);
  });
});

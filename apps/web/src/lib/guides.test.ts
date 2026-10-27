import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SHOTS } from "@/lib/guide-shots";

import { GUIDES, findGuide } from "@/lib/guides";
import { GUIDE_OF, GUIDE_SLUGS, type GuideAnchor, guideHref } from "@/lib/guides-types";

describe("guides", () => {
  it("has one guide per slug, in order", () => {
    expect(GUIDES.map((g) => g.slug)).toEqual([...GUIDE_SLUGS]);
  });

  it("puts every linkable anchor in the guide GUIDE_OF names — so no help link is dead", () => {
    for (const [anchor, slug] of Object.entries(GUIDE_OF)) {
      const guide = findGuide(slug)!;
      expect(
        guide.sections.map((s) => s.id),
        `${anchor} in ${slug}`,
      ).toContain(anchor);
    }
  });

  it("registers every section as an anchor, each once", () => {
    const ids = GUIDES.flatMap((g) => g.sections.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(GUIDE_OF).sort());
  });

  it("builds links as /help#<anchor>", () => {
    expect(guideHref("winner" satisfies GuideAnchor)).toBe("/help#winner");
  });

  it("gives every section some content", () => {
    for (const g of GUIDES) for (const s of g.sections) expect(s.blocks.length).toBeGreaterThan(0);
  });

  it("has a file in public/ for every screenshot", () => {
    for (const shot of Object.values(SHOTS)) {
      expect(existsSync(join(__dirname, "../../public", shot.src)), shot.src).toBe(true);
    }
  });
});

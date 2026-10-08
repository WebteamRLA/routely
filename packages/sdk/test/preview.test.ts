import { describe, expect, it } from "vitest";

import { isSameUrl } from "../src/url";
import { readPreview, withPreview, withoutPreview } from "../src/preview";

describe("preview links", () => {
  it("reads the experiment and arm", () => {
    expect(readPreview("https://acme.test/p?routely_preview=exp_1:2")).toEqual({
      experimentId: "exp_1",
      position: 2,
    });
  });

  it("defaults to control when no arm is given", () => {
    expect(readPreview("https://acme.test/p?routely_preview=exp_1")).toEqual({
      experimentId: "exp_1",
      position: 0,
    });
  });

  it("ignores anything malformed rather than guessing", () => {
    for (const value of ["", "exp_1:-1", "exp_1:1.5", "exp_1:x", "bad id:1", "exp_1:99"]) {
      expect(readPreview(`https://acme.test/p?routely_preview=${encodeURIComponent(value)}`)).toBe(
        null,
      );
    }
    expect(readPreview("https://acme.test/p")).toBeNull();
    expect(readPreview("not a url")).toBeNull();
  });

  it("carries the preview onto a redirect target so the variant page stays silent too", () => {
    const target = withPreview("https://acme.test/v2?a=1", { experimentId: "exp_1", position: 1 });
    expect(readPreview(target)).toEqual({ experimentId: "exp_1", position: 1 });
    expect(new URL(target).searchParams.get("a")).toBe("1");
  });

  it("recognises the variant page it redirected to, so a preview cannot loop", () => {
    const preview = { experimentId: "exp_1", position: 1 };
    const landed = withPreview("https://acme.test/v2?a=1", preview);
    expect(isSameUrl(landed, "https://acme.test/v2?a=1")).toBe(false);
    expect(isSameUrl(withoutPreview(landed), "https://acme.test/v2?a=1")).toBe(true);
    expect(withoutPreview("not a url")).toBe("not a url");
  });
});

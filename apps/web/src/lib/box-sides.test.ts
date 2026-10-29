import { describe, expect, it } from "vitest";

import { formatBox, joinSide, parseBox, splitSide } from "@/lib/box-sides";
import { isBoxValue } from "@/lib/style-values";

describe("parseBox / formatBox", () => {
  it("expands shorthand the way CSS does", () => {
    expect(parseBox("8px")).toEqual(["8px", "8px", "8px", "8px"]);
    expect(parseBox("8px 16px")).toEqual(["8px", "16px", "8px", "16px"]);
    expect(parseBox("1px 2px 3px")).toEqual(["1px", "2px", "3px", "2px"]);
    expect(parseBox("1px 2px 3px 4px")).toEqual(["1px", "2px", "3px", "4px"]);
    expect(parseBox("")).toBeNull();
    expect(parseBox("1px 2px 3px 4px 5px")).toBeNull();
  });

  it("writes the shortest shorthand back", () => {
    expect(formatBox(["8px", "8px", "8px", "8px"])).toBe("8px");
    expect(formatBox(["8px", "16px", "8px", "16px"])).toBe("8px 16px");
    expect(formatBox(["1px", "2px", "3px", "2px"])).toBe("1px 2px 3px");
    expect(formatBox(["1px", "2px", "3px", "4px"])).toBe("1px 2px 3px 4px");
  });
});

describe("splitSide / joinSide", () => {
  it("reads number and unit, including the page's long computed fractions", () => {
    expect(splitSide("16px")).toEqual({ num: "16", unit: "px" });
    expect(splitSide("1.5rem")).toEqual({ num: "1.5", unit: "rem" });
    expect(splitSide("19.1953px")).toEqual({ num: "19.2", unit: "px" });
    expect(splitSide("0")).toEqual({ num: "0", unit: "px" });
    expect(splitSide("auto")).toEqual({ num: "", unit: "auto" });
  });

  it("writes values the server accepts", () => {
    expect(joinSide({ num: "16", unit: "px" }, false)).toBe("16px");
    expect(joinSide({ num: "0", unit: "rem" }, false)).toBe("0");
    expect(joinSide({ num: "", unit: "px" }, false)).toBe("0");
    expect(joinSide({ num: "-8", unit: "px" }, false)).toBe("0");
    expect(joinSide({ num: "-8", unit: "px" }, true)).toBe("-8px");
    expect(joinSide({ num: "1.239", unit: "em" }, false)).toBe("1.24em");
    expect(joinSide({ num: "", unit: "auto" }, true)).toBe("auto");
    for (const side of ["16px", "0", "1.24em", "50%"]) expect(isBoxValue(side, false)).toBe(true);
  });
});

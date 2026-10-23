import { describe, expect, it } from "vitest";

import { personalWorkspaceName } from "@/lib/workspace-name";

describe("personalWorkspaceName", () => {
  it("uses the first word of the name", () => {
    expect(personalWorkspaceName("Rakibul Hasan", "r@blinto.co")).toBe("Rakibul’s workspace");
  });

  it("falls back to the email's local part", () => {
    expect(personalWorkspaceName(null, "fazle.rla@gmail.com")).toBe("fazle.rla’s workspace");
    expect(personalWorkspaceName("   ", "dev@routely.local")).toBe("dev’s workspace");
  });

  it("stays within 80 characters", () => {
    expect(personalWorkspaceName("x".repeat(200), "a@b.c").length).toBeLessThanOrEqual(80);
  });
});

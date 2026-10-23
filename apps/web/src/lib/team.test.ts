import { describe, expect, it } from "vitest";

import {
  formatInviteExpiry,
  formatLastActive,
  initialsOf,
  inviteErrors,
  parseInviteEmails,
  roleFromLabel,
  withArticle,
} from "@/lib/team";

describe("parseInviteEmails", () => {
  it("splits on commas, semicolons and whitespace, lower-cases and de-duplicates", () => {
    expect(parseInviteEmails(" A@x.com, b@x.com;a@X.com\n c@x.com ")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });
});

describe("inviteErrors", () => {
  it("requires at least one address", () => {
    expect(inviteErrors("  , ", [], [])).toEqual(["Enter at least one email address."]);
  });

  it("uses the design's singular and plural messages, in order", () => {
    expect(inviteErrors("bad, jamie@f.com, sam@f.com", ["jamie@f.com"], ["sam@f.com"])).toEqual([
      "Check this address: bad",
      "jamie@f.com is already on the team.",
      "sam@f.com already has a pending invite.",
    ]);
    expect(
      inviteErrors(
        "x, y, a@f.com, b@f.com, c@f.com, d@f.com",
        ["a@f.com", "b@f.com"],
        ["c@f.com", "d@f.com"],
      ),
    ).toEqual([
      "Check these addresses: x, y",
      "Already on the team: a@f.com, b@f.com",
      "Already invited: c@f.com, d@f.com",
    ]);
  });

  it("caps a submission at 10 addresses", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `p${i}@f.com`).join(",");
    expect(inviteErrors(eleven, [], [])).toEqual(["You can invite up to 10 people at a time."]);
    expect(inviteErrors(eleven.split(",").slice(0, 10).join(","), [], [])).toEqual([]);
  });
});

describe("roles", () => {
  it("never maps a label to OWNER", () => {
    expect(roleFromLabel("Owner")).toBeNull();
    expect(roleFromLabel("OWNER")).toBeNull();
    expect(roleFromLabel("Admin")).toBe("ADMIN");
    expect(roleFromLabel("Viewer")).toBe("VIEWER");
  });

  it("chooses the article", () => {
    expect(withArticle("Admin")).toBe("an Admin");
    expect(withArticle("Editor")).toBe("an Editor");
    expect(withArticle("Viewer")).toBe("a Viewer");
  });
});

describe("labels", () => {
  const now = new Date("2026-10-13T15:00:00Z");

  it("formats last active", () => {
    expect(formatLastActive(null, now)).toBe("—");
    expect(formatLastActive(new Date("2026-10-13T14:56:00Z"), now)).toBe("Active now");
    expect(formatLastActive(new Date("2026-10-13T09:12:00Z"), now)).toBe("Today, 9:12 AM");
    expect(formatLastActive(new Date("2026-10-12T16:40:00Z"), now)).toBe("Yesterday, 4:40 PM");
    expect(formatLastActive(new Date("2026-10-08T10:00:00Z"), now)).toBe("Oct 8, 2026");
  });

  it("counts invite expiry up in whole days", () => {
    expect(formatInviteExpiry(new Date("2026-10-18T09:00:00Z"), now)).toBe("Expires in 5 days");
    expect(formatInviteExpiry(new Date("2026-10-13T16:00:00Z"), now)).toBe("Expires in 1 day");
    expect(formatInviteExpiry(now, now)).toBe("Expired");
  });

  it("takes initials from the first and last word", () => {
    expect(initialsOf("Alex Morgan")).toBe("AM");
    expect(initialsOf("Priya van der Shah")).toBe("PS");
    expect(initialsOf("alex@x.com")).toBe("A");
  });
});

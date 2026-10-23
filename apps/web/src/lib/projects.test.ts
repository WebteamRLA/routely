import { describe, expect, it } from "vitest";

import {
  nextColorIndex,
  normalizeDomain,
  pixelCheckUrl,
  pixelDefaultUrl,
  pixelUrlError,
  projectAddressError,
  projectFormErrors,
  projectNameError,
  projectTile,
  protocolFromAddress,
  seenAgo,
  trackFromState,
  trackingSeenLine,
} from "./projects";
import {
  createProjectSchema,
  deleteProjectSchema,
  updateProjectSchema,
} from "@/validation/website";

const projects = [
  { id: "p1", name: "Fernwood Supply", domain: "fernwoodsupply.com" },
  { id: "p2", name: "Fernwood Journal", domain: "journal.fernwoodsupply.com" },
];

describe("normalizeDomain", () => {
  it("strips scheme, www, port and everything after the host, and lower-cases", () => {
    expect(normalizeDomain("  https://www.Shop.Example.com:8080/path?q=1#x ")).toBe(
      "shop.example.com",
    );
    expect(normalizeDomain("http://acme.co")).toBe("acme.co");
    expect(normalizeDomain("acme.com/")).toBe("acme.com");
  });
});

describe("project name and address rules", () => {
  it("uses the design's messages", () => {
    expect(projectNameError("  ")).toBe("Give your project a name.");
    expect(projectNameError("x".repeat(61))).toBe("Use 60 characters or fewer.");
    expect(projectNameError("x".repeat(60))).toBe("");
    expect(projectAddressError("")).toBe("Enter your website’s address.");
    expect(projectAddressError("fernwood")).toBe("Enter a valid address, like example.com.");
    expect(projectAddressError("localhost:3000")).toBe("Enter a valid address, like example.com.");
    expect(projectAddressError("https://www.acme.com/pricing")).toBe("");
  });

  it("reads the protocol from a typed scheme, defaulting to HTTPS", () => {
    expect(protocolFromAddress("http://acme.com")).toBe("HTTP");
    expect(protocolFromAddress("HTTP://acme.com")).toBe("HTTP");
    expect(protocolFromAddress("https://acme.com")).toBe("HTTPS");
    expect(protocolFromAddress("acme.com")).toBe("HTTPS");
  });

  it("flags duplicate names case-insensitively and duplicate domains after normalising", () => {
    expect(
      projectFormErrors({ name: "fernwood SUPPLY", url: "new.example.com" }, projects),
    ).toEqual({
      name: "You already have a project called “Fernwood Supply”.",
      url: "",
    });
    expect(
      projectFormErrors({ name: "New", url: "https://www.journal.fernwoodsupply.com/x" }, projects),
    ).toEqual({
      name: "",
      url: "journal.fernwoodsupply.com is already used by “Fernwood Journal”.",
    });
  });

  it("ignores the project being edited", () => {
    expect(
      projectFormErrors({ name: "Fernwood Supply", url: "fernwoodsupply.com" }, projects, "p1"),
    ).toEqual({ name: "", url: "" });
  });
});

describe("validation/website project schemas", () => {
  it("normalises the address into domain + protocol", () => {
    const parsed = createProjectSchema.parse({ name: "  Acme ", url: "http://www.Acme.com/x" });
    expect(parsed).toEqual({ name: "Acme", url: { domain: "acme.com", protocol: "HTTP" } });
  });

  it("reports both fields with the design's messages", () => {
    const result = createProjectSchema.safeParse({ name: "", url: "fernwood" });
    expect(result.success).toBe(false);
    const issues = result.error!.issues.map((i) => [i.path.join("."), i.message]);
    expect(issues).toEqual([
      ["name", "Give your project a name."],
      ["url", "Enter a valid address, like example.com."],
    ]);
  });

  it("rejects a missing field and an id with path characters", () => {
    expect(createProjectSchema.safeParse({ url: "acme.com" }).success).toBe(false);
    expect(
      updateProjectSchema.safeParse({ websiteId: "../x", name: "A", url: "acme.com" }).success,
    ).toBe(false);
    expect(deleteProjectSchema.safeParse({ websiteId: "abc", confirmName: "A" }).success).toBe(
      true,
    );
  });
});

describe("pixelUrlError", () => {
  it("accepts the domain, www and subdomains (the server's isSameSite rule)", () => {
    expect(pixelUrlError("https://acme.com/", "acme.com")).toBe("");
    expect(pixelUrlError("https://www.acme.com/a", "acme.com")).toBe("");
    expect(pixelUrlError("blog.acme.com/post", "acme.com")).toBe("");
  });

  it("rejects other sites, look-alikes and garbage with the design's copy", () => {
    expect(pixelUrlError("", "acme.com")).toBe("Enter the URL of a page on your site.");
    expect(pixelUrlError("not a url", "acme.com")).toBe(
      "Enter a valid URL, like https://acme.com/",
    );
    expect(pixelUrlError("https://evil-acme.com/", "acme.com")).toBe(
      "This project tracks acme.com. Enter a page on that site.",
    );
    expect(pixelUrlError("https://acme.com.evil.test/", "acme.com")).toBe(
      "This project tracks acme.com. Enter a page on that site.",
    );
  });

  it("adds the project's scheme when the customer typed none", () => {
    expect(pixelCheckUrl("acme.com/x", "HTTP")).toBe("http://acme.com/x");
    expect(pixelCheckUrl("https://acme.com/x", "HTTP")).toBe("https://acme.com/x");
    expect(pixelDefaultUrl("acme.com", "HTTPS")).toBe("https://acme.com/");
  });
});

describe("tiles and tracking labels", () => {
  it("assigns colours round-robin by project count", () => {
    expect([0, 1, 4, 5, 7].map(nextColorIndex)).toEqual([0, 1, 4, 0, 2]);
    expect(projectTile("fernwood", 2)).toEqual({ initial: "F", color: "#DCFCE7", ink: "#166534" });
    expect(projectTile("x", 9).color).toBe(projectTile("x", 4).color);
  });

  it("maps tracking states and words the line under the badge", () => {
    expect(trackFromState("active")).toBe("active");
    expect(trackFromState("not_seen")).toBe("stale");
    expect(trackFromState("not_installed")).toBe("none");
    expect(trackingSeenLine("active", "4 min ago")).toBe("Last seen 4 min ago");
    expect(trackingSeenLine("none", null)).toBe("Snippet not installed");
    const now = new Date("2026-10-19T12:00:00Z");
    expect(seenAgo(new Date("2026-10-19T11:56:00Z"), now)).toBe("4 min ago");
    expect(seenAgo(new Date("2026-09-24T11:00:00Z"), now)).toBe("25 days ago");
    expect(seenAgo(new Date("2026-10-18T11:00:00Z"), now)).toBe("1 day ago");
    expect(seenAgo(null, now)).toBeNull();
  });
});

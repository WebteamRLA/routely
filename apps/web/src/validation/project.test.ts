import { describe, expect, it } from "vitest";

import { inviteMemberSchema, memberRoleSchema } from "@/validation/member";
import { createMetricSchema, pageVisitKey } from "@/validation/metric";
import {
  addDomainSchema,
  createProjectSchema,
  protocolFromInput,
  updateProjectSchema,
} from "@/validation/website";

describe("createProjectSchema", () => {
  it("normalises a pasted URL to a bare domain", () => {
    const parsed = createProjectSchema.parse({
      name: "Kestrel",
      domain: "https://www.KestrelHQ.com/pricing?x=1",
    });
    expect(parsed.domain).toBe("kestrelhq.com");
    expect(parsed.protocol).toBe("HTTPS");
  });

  it("drops a port — a domain is compared by hostname", () => {
    expect(createProjectSchema.parse({ name: "Local", domain: "shop.test:3000" }).domain).toBe(
      "shop.test",
    );
  });

  it("uses the prototype's messages", () => {
    const short = createProjectSchema.safeParse({ name: "K", domain: "kestrelhq.com" });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toBe("Enter a project name.");

    const empty = createProjectSchema.safeParse({ name: "Kestrel", domain: "" });
    expect(empty.error?.issues[0]?.message).toBe("Enter your website URL.");

    const invalid = createProjectSchema.safeParse({ name: "Kestrel", domain: "localhost" });
    expect(invalid.error?.issues[0]?.message).toBe(
      "Enter a valid website, e.g. https://www.example.com",
    );
  });

  it("reads http:// as the http protocol", () => {
    expect(protocolFromInput("http://acme.test")).toBe("HTTP");
    expect(protocolFromInput("acme.test")).toBe("HTTPS");
    expect(protocolFromInput(undefined)).toBe("HTTPS");
  });
});

describe("updateProjectSchema", () => {
  it("accepts 90/95/99 as a percentage or a fraction", () => {
    expect(
      updateProjectSchema.parse({ projectId: "p1", significanceThreshold: 0.99 })
        .significanceThreshold,
    ).toBe(99);
    expect(
      updateProjectSchema.parse({ projectId: "p1", significanceThreshold: "90" })
        .significanceThreshold,
    ).toBe(90);
    expect(
      updateProjectSchema.safeParse({ projectId: "p1", significanceThreshold: 80 }).success,
    ).toBe(false);
  });

  it("validates IANA time zones against the runtime database", () => {
    expect(
      updateProjectSchema.safeParse({ projectId: "p1", timezone: "Europe/London" }).success,
    ).toBe(true);
    expect(updateProjectSchema.safeParse({ projectId: "p1", timezone: "UTC" }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ projectId: "p1", timezone: "Mars/Base" }).success).toBe(
      false,
    );
  });

  it("maps the install method keys", () => {
    expect(updateProjectSchema.parse({ projectId: "p1", installMethod: "gtm" }).installMethod).toBe(
      "GTM",
    );
    expect(
      updateProjectSchema.parse({ projectId: "p1", installMethod: "direct" }).installMethod,
    ).toBe("MANUAL");
  });
});

describe("addDomainSchema", () => {
  it("normalises and validates an additional domain", () => {
    expect(
      addDomainSchema.parse({ projectId: "p1", domain: "https://Shop.Acme.com/" }).domain,
    ).toBe("shop.acme.com");
    const bad = addDomainSchema.safeParse({ projectId: "p1", domain: "nope" });
    expect(bad.error?.issues[0]?.message).toBe("Enter a domain like shop.example.com");
  });
});

describe("member schemas (seam)", () => {
  it("lowercases the email and maps the role label", () => {
    const parsed = inviteMemberSchema.parse({
      projectId: "p1",
      email: " Priya@Example.COM ",
      role: "Viewer",
    });
    expect(parsed).toEqual({ projectId: "p1", email: "priya@example.com", role: "VIEWER" });
  });

  it("refuses Owner and a malformed email", () => {
    expect(memberRoleSchema.safeParse("Owner").success).toBe(false);
    const bad = inviteMemberSchema.safeParse({ projectId: "p1", email: "nope" });
    expect(bad.error?.issues[0]?.message).toBe("Enter a valid email address.");
  });
});

describe("createMetricSchema", () => {
  it("requires a snake_case key for a custom event", () => {
    expect(
      createMetricSchema.safeParse({
        projectId: "p1",
        name: "Demo",
        kind: "event",
        key: "demo_booked",
      }).success,
    ).toBe(true);
    const missing = createMetricSchema.safeParse({ projectId: "p1", name: "Demo", kind: "event" });
    expect(missing.error?.issues[0]?.message).toBe("Event name is required.");
    const bad = createMetricSchema.safeParse({
      projectId: "p1",
      name: "Demo",
      kind: "event",
      key: "Demo-Booked",
    });
    expect(bad.error?.issues[0]?.message).toBe(
      "Use lowercase letters, numbers and underscores, e.g. demo_booked",
    );
  });

  it("requires a full URL for a page visit", () => {
    const missing = createMetricSchema.safeParse({ projectId: "p1", name: "Thanks", kind: "page" });
    expect(missing.error?.issues[0]?.message).toBe("Enter the URL that counts as a conversion.");
    const parsed = createMetricSchema.parse({
      projectId: "p1",
      name: "Thanks",
      kind: "page",
      url: "https://acme.com/thanks",
      matchType: "starts",
    });
    expect(parsed.kind).toBe("PAGE_VISIT");
    expect(parsed.matchType).toBe("PREFIX");
  });

  it("requires a name", () => {
    const parsed = createMetricSchema.safeParse({
      projectId: "p1",
      name: " ",
      kind: "event",
      key: "x",
    });
    expect(parsed.error?.issues[0]?.message).toBe("Name is required.");
  });

  it("derives page-visit keys from the name", () => {
    expect(pageVisitKey("Thank you page!")).toBe("page_view_thank_you_page");
    expect(pageVisitKey("  ")).toBe("page_view_page");
  });
});

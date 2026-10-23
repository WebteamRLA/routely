import { describe, expect, it } from "vitest";

import {
  type Capability,
  type MemberRole,
  MEMBER_ROLES,
  can,
  canChangeRole,
  canDeleteExperiment,
  canInviteAs,
  canManageMember,
  hasRole,
  rolesAtLeast,
  rolesThatCanDeleteExperiment,
  rolesWith,
} from "@/lib/permissions";

/** The §1.2 matrix, row by row: which of O / A / E / V hold each capability. */
const MATRIX: Record<Capability, [boolean, boolean, boolean, boolean]> = {
  view: [true, true, true, true],
  "experiment.edit": [true, true, true, false],
  "share.manage": [true, true, true, false],
  "project.manage": [true, true, false, false],
  "pixel.verify": [true, true, true, false],
  "sheets.manage": [true, true, false, false],
  "sheets.sync": [true, true, true, false],
  "team.manage": [true, true, false, false],
  "workspace.manage": [true, false, false, false],
};

describe("permission matrix", () => {
  for (const [capability, expected] of Object.entries(MATRIX) as [Capability, boolean[]][]) {
    it(`${capability}`, () => {
      expect(MEMBER_ROLES.map((role) => can(role, capability))).toEqual(expected);
      // The where-clause roles must be exactly the roles `can` says yes to.
      expect(rolesWith(capability)).toEqual(MEMBER_ROLES.filter((role) => can(role, capability)));
    });
  }
});

describe("hasRole / rolesAtLeast", () => {
  it("orders roles Owner > Admin > Editor > Viewer", () => {
    expect(hasRole("OWNER", "ADMIN")).toBe(true);
    expect(hasRole("ADMIN", "OWNER")).toBe(false);
    expect(hasRole("EDITOR", "EDITOR")).toBe(true);
    expect(hasRole("VIEWER", "EDITOR")).toBe(false);
    expect(rolesAtLeast("EDITOR")).toEqual(["OWNER", "ADMIN", "EDITOR"]);
    expect(rolesAtLeast("VIEWER")).toEqual(MEMBER_ROLES);
  });
});

describe("deleting an experiment", () => {
  it("lets Admins and the Owner delete anything", () => {
    for (const status of ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"] as const) {
      expect(canDeleteExperiment("OWNER", status)).toBe(true);
      expect(canDeleteExperiment("ADMIN", status)).toBe(true);
    }
  });

  it("lets an Editor delete drafts only, and a Viewer nothing", () => {
    expect(canDeleteExperiment("EDITOR", "DRAFT")).toBe(true);
    expect(canDeleteExperiment("EDITOR", "ACTIVE")).toBe(false);
    expect(canDeleteExperiment("EDITOR", "COMPLETED")).toBe(false);
    expect(canDeleteExperiment("VIEWER", "DRAFT")).toBe(false);
    expect(rolesThatCanDeleteExperiment("DRAFT")).toEqual(["OWNER", "ADMIN", "EDITOR"]);
    expect(rolesThatCanDeleteExperiment("PAUSED")).toEqual(["OWNER", "ADMIN"]);
  });
});

describe("team management", () => {
  const notSelf = { isSelf: false };

  it("never invites anyone as Owner", () => {
    expect(canInviteAs("OWNER", "OWNER")).toBe(false);
    expect(canInviteAs("ADMIN", "ADMIN")).toBe(true);
    expect(canInviteAs("EDITOR", "VIEWER")).toBe(false);
  });

  it("lets Admins manage any non-Owner, including other Admins", () => {
    const targets: MemberRole[] = ["ADMIN", "EDITOR", "VIEWER"];
    for (const target of targets) {
      expect(canManageMember("ADMIN", target, notSelf)).toBe(true);
      expect(canManageMember("OWNER", target, notSelf)).toBe(true);
      expect(canManageMember("EDITOR", target, notSelf)).toBe(false);
    }
  });

  it("protects the Owner and forbids managing yourself", () => {
    expect(canManageMember("ADMIN", "OWNER", notSelf)).toBe(false);
    expect(canManageMember("OWNER", "OWNER", { isSelf: true })).toBe(false);
    expect(canManageMember("ADMIN", "EDITOR", { isSelf: true })).toBe(false);
  });

  it("never grants the Owner role through a role change", () => {
    expect(canChangeRole("OWNER", "ADMIN", "OWNER", notSelf)).toBe(false);
    expect(canChangeRole("OWNER", "ADMIN", "VIEWER", notSelf)).toBe(true);
    expect(canChangeRole("ADMIN", "OWNER", "VIEWER", notSelf)).toBe(false);
  });
});

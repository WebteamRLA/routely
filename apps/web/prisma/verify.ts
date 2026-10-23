/**
 * Data-model verification.
 *
 * Exercises the guarantees the schema is supposed to provide — tenant isolation, one owner per
 * workspace, pending-invite uniqueness, visitor-day idempotency, assignment consistency,
 * conversion idempotency and the dashboard aggregation paths — against a real
 * Postgres instance, then removes everything it created.
 *
 *   npm run db:verify --workspace @routely/web
 *
 * This is a smoke test for the data layer, not a replacement for unit tests; those arrive
 * with the ingestion logic in Part 5.
 */

import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to apps/web/.env first.");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const suffix = `verify-${process.pid}`;

  const [owner, stranger] = await Promise.all([
    db.user.create({ data: { email: `owner-${suffix}@routely.test`, name: "Owner" } }),
    db.user.create({ data: { email: `stranger-${suffix}@routely.test`, name: "Stranger" } }),
  ]);

  // Each user gets their own workspace, as the app does at sign-up.
  const [ownerSpace, strangerSpace] = await Promise.all(
    [owner, stranger].map((user) =>
      db.workspace.create({
        data: {
          name: `${user.name}\u2019s workspace`,
          memberships: { create: { userId: user.id, role: "OWNER" } },
        },
      }),
    ),
  );

  const website = await db.website.create({
    data: {
      workspaceId: ownerSpace!.id,
      createdById: owner.id,
      name: "Verify Co",
      domain: "verify.test",
      publicSiteId: `rt_${suffix.replace(/-/g, "")}${"0".repeat(24)}`.slice(0, 35),
    },
  });

  const experiment = await db.experiment.create({
    data: {
      websiteId: website.id,
      name: "Verify experiment",
      controlUrl: "https://verify.test/a",
      conversionUrl: "https://verify.test/done",
      status: "ACTIVE",
      variants: { create: [{ position: 1, name: "Variant A", url: "https://verify.test/b" }] },
    },
    include: { variants: true },
  });
  const variant = experiment.variants[0]!;

  // The same shape as `src/server/repositories/access.ts`, which this script cannot import.
  const member = (userId: string, roles?: ("OWNER" | "ADMIN" | "EDITOR" | "VIEWER")[]) => ({
    workspace: { memberships: { some: { userId, ...(roles ? { role: { in: roles } } : {}) } } },
  });

  console.log("\nTenant isolation");
  {
    const asOwner = await db.website.findFirst({ where: { id: website.id, ...member(owner.id) } });
    const asStranger = await db.website.findFirst({
      where: { id: website.id, ...member(stranger.id) },
    });
    check("a member reads their workspace's website", asOwner !== null);
    check("a non-member cannot read it by id", asStranger === null);

    const nested = await db.experiment.findFirst({
      where: { id: experiment.id, website: member(stranger.id) },
    });
    check("experiment is not reachable through another workspace's filter", nested === null);

    // A viewer is a member — they can read — but a write filtered to editors matches nothing.
    await db.membership.create({
      data: { workspaceId: ownerSpace!.id, userId: stranger.id, role: "VIEWER" },
    });
    const viewerReads = await db.website.findFirst({
      where: { id: website.id, ...member(stranger.id) },
    });
    const viewerWrite = await db.experiment.updateMany({
      where: { id: experiment.id, website: member(stranger.id, ["OWNER", "ADMIN", "EDITOR"]) },
      data: { name: "renamed by a viewer" },
    });
    check("a viewer can read the workspace's website", viewerReads !== null);
    check("a role-filtered write by a viewer changes nothing", viewerWrite.count === 0);
    await db.membership.deleteMany({ where: { workspaceId: ownerSpace!.id, userId: stranger.id } });
  }

  console.log("\nWorkspace ownership");
  {
    let secondOwnerRejected = false;
    try {
      await db.membership.create({
        data: { workspaceId: ownerSpace!.id, userId: stranger.id, role: "OWNER" },
      });
    } catch {
      secondOwnerRejected = true;
    }
    check("a workspace cannot have a second OWNER", secondOwnerRejected);

    const admin = await db.membership.create({
      data: { workspaceId: ownerSpace!.id, userId: stranger.id, role: "ADMIN" },
    });
    check("a non-owner member can be added alongside the owner", admin.role === "ADMIN");
    await db.membership.delete({ where: { id: admin.id } });

    const owners = await db.membership.count({
      where: { workspaceId: ownerSpace!.id, role: "OWNER" },
    });
    check("exactly one owner per workspace", owners === 1, `found ${owners}`);
  }

  console.log("\nInvites");
  {
    const invite = (tokenHash: string) =>
      db.workspaceInvite.create({
        data: {
          workspaceId: ownerSpace!.id,
          email: `invitee-${suffix}@routely.test`,
          role: "EDITOR",
          tokenHash,
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

    const first = await invite(`hash-1-${suffix}`);
    let duplicateRejected = false;
    try {
      await invite(`hash-2-${suffix}`);
    } catch {
      duplicateRejected = true;
    }
    check("a second pending invite for the same address is rejected", duplicateRejected);

    await db.workspaceInvite.update({ where: { id: first.id }, data: { revokedAt: new Date() } });
    const reissued = await invite(`hash-3-${suffix}`);
    check("a revoked invite does not block a new one", reissued.id !== first.id);
  }

  console.log("\nVisitor days");
  {
    const day = new Date(Date.UTC(2026, 9, 19));
    const row = { websiteId: website.id, day, anonymousId: "anon-day" };
    const first = await db.websiteVisitorDay.createMany({ data: [row], skipDuplicates: true });
    const again = await db.websiteVisitorDay.createMany({ data: [row], skipDuplicates: true });
    const pageRow = { ...row, urlKey: "https://verify.test/a" };
    const pageFirst = await db.pageVisitorDay.createMany({ data: [pageRow], skipDuplicates: true });
    const pageAgain = await db.pageVisitorDay.createMany({ data: [pageRow], skipDuplicates: true });
    const total = await db.websiteVisitorDay.count({ where: { websiteId: website.id } });

    check("a browser counts once per website per day", first.count === 1 && again.count === 0);
    check("a browser counts once per page per day", pageFirst.count === 1 && pageAgain.count === 0);
    check("exactly one visitor-day row exists", total === 1, `found ${total}`);
  }

  console.log("\nActivity");
  {
    await db.experimentActivity.create({
      data: { experimentId: experiment.id, type: "RESULT_READY" },
    });
    let secondRejected = false;
    try {
      await db.experimentActivity.create({
        data: { experimentId: experiment.id, type: "RESULT_READY" },
      });
    } catch {
      secondRejected = true;
    }
    check("RESULT_READY is recorded at most once per experiment", secondRejected);
  }

  console.log("\nVisitor identity");
  const visitor = await db.visitor.upsert({
    where: { websiteId_anonymousId: { websiteId: website.id, anonymousId: "anon-1" } },
    create: { websiteId: website.id, anonymousId: "anon-1" },
    update: { lastSeenAt: new Date() },
  });
  {
    const again = await db.visitor.upsert({
      where: { websiteId_anonymousId: { websiteId: website.id, anonymousId: "anon-1" } },
      create: { websiteId: website.id, anonymousId: "anon-1" },
      update: { lastSeenAt: new Date() },
    });
    check("repeated upsert resolves to the same visitor", again.id === visitor.id);

    let duplicateRejected = false;
    try {
      await db.visitor.create({ data: { websiteId: website.id, anonymousId: "anon-1" } });
    } catch {
      duplicateRejected = true;
    }
    check("duplicate (websiteId, anonymousId) is rejected", duplicateRejected);
  }

  console.log("\nAssignment consistency");
  const assignment = await db.assignment.upsert({
    where: { experimentId_visitorId: { experimentId: experiment.id, visitorId: visitor.id } },
    create: { experimentId: experiment.id, visitorId: visitor.id, variantId: null },
    update: {},
  });
  {
    // A client reporting the opposite arm must not be able to flip a stored assignment.
    const reasserted = await db.assignment.upsert({
      where: { experimentId_visitorId: { experimentId: experiment.id, visitorId: visitor.id } },
      create: { experimentId: experiment.id, visitorId: visitor.id, variantId: variant.id },
      update: {},
    });
    check("assignment is stable across repeated reports", reasserted.id === assignment.id);
    check("the stored arm wins over a conflicting report", reasserted.variantId === null);

    const total = await db.assignment.count({
      where: { experimentId: experiment.id, visitorId: visitor.id },
    });
    check("a visitor holds exactly one arm", total === 1, `found ${total}`);
  }

  console.log("\nConversion idempotency");
  {
    const first = await db.conversion.createMany({
      data: [
        {
          experimentId: experiment.id,
          visitorId: visitor.id,
          assignmentId: assignment.id,
          variantId: null,
          url: "https://verify.test/done",
          occurredAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    const second = await db.conversion.createMany({
      data: [
        {
          experimentId: experiment.id,
          visitorId: visitor.id,
          assignmentId: assignment.id,
          variantId: null,
          url: "https://verify.test/done",
          occurredAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    const total = await db.conversion.count({ where: { assignmentId: assignment.id } });

    check("the first conversion is recorded", first.count === 1);
    check("a duplicate beacon is silently ignored", second.count === 0);
    check("exactly one conversion exists for the assignment", total === 1, `found ${total}`);
  }

  console.log("\nAggregation");
  {
    await db.event.createMany({
      data: [
        {
          websiteId: website.id,
          experimentId: experiment.id,
          visitorId: visitor.id,
          assignmentId: assignment.id,
          variantId: null,
          type: "page_view",
          url: "https://verify.test/a",
          occurredAt: new Date(),
        },
        {
          websiteId: website.id,
          experimentId: experiment.id,
          visitorId: visitor.id,
          assignmentId: assignment.id,
          variantId: null,
          type: "time_on_page",
          url: "https://verify.test/a",
          durationMs: 12_000,
          occurredAt: new Date(),
        },
      ],
    });

    const grouped = await db.event.groupBy({
      by: ["variantId", "type"],
      where: { experimentId: experiment.id },
      _count: { _all: true },
      _sum: { durationMs: true },
    });

    const pageViews = grouped.find((r) => r.type === "page_view")?._count._all ?? 0;
    const visibleMs = grouped.find((r) => r.type === "time_on_page")?._sum.durationMs ?? 0;

    check("page views group by arm and type", pageViews === 1, `got ${pageViews}`);
    check("visible time sums per arm", visibleMs === 12_000, `got ${visibleMs}`);

    const assignments = await db.assignment.groupBy({
      by: ["variantId"],
      where: { experimentId: experiment.id },
      _count: { _all: true },
    });
    const conversions = await db.conversion.groupBy({
      by: ["variantId"],
      where: { experimentId: experiment.id },
      _count: { _all: true },
    });

    const visitors = assignments.find((r) => r.variantId === null)?._count._all ?? 0;
    const converted = conversions.find((r) => r.variantId === null)?._count._all ?? 0;
    check(
      "conversion rate is computable from two grouped counts",
      visitors === 1 && converted === 1,
      `${converted}/${visitors}`,
    );
  }

  console.log("\nCascade");
  {
    await db.website.delete({ where: { id: website.id } });

    const [experiments, visitors, assignments, events, conversions] = await Promise.all([
      db.experiment.count({ where: { websiteId: website.id } }),
      db.visitor.count({ where: { websiteId: website.id } }),
      db.assignment.count({ where: { experimentId: experiment.id } }),
      db.event.count({ where: { websiteId: website.id } }),
      db.conversion.count({ where: { experimentId: experiment.id } }),
    ]);

    check(
      "deleting a website removes its whole tree",
      experiments === 0 && visitors === 0 && assignments === 0 && events === 0 && conversions === 0,
      `${experiments}/${visitors}/${assignments}/${events}/${conversions} left`,
    );
  }

  // Workspaces are not owned by a user row, so they are removed explicitly (invites cascade).
  await db.workspace.deleteMany({ where: { id: { in: [ownerSpace!.id, strangerSpace!.id] } } });
  await db.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

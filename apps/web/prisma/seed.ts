/**
 * Development seed — the prototype's dataset, on the real schema.
 *
 * Seeds three projects for the local developer (`dev@routely.local`, the user AUTH_DEV_BYPASS
 * signs in as):
 *
 *  - **Kestrel** (kestrelhq.com + app.kestrelhq.com, installed): nine experiments of both types
 *    in every status — three running, one paused, two drafts, and three completed (a variant
 *    winner, a control win and an inconclusive one) — with day-by-day assignments, page views,
 *    approximate visible time and conversions, plus metrics, metric hits, a team and activity.
 *  - **Northwind Coffee** (northwindcoffee.com, installed): four experiments, one of them on a
 *    URL goal.
 *  - **Lumen Studio** (lumenstudio.io): fresh — not installed, no experiments, metrics never
 *    received.
 *
 * Traffic is generated with the prototype's own generator (Park–Miller LCG, weekly wave), at
 * half the prototype's volume so a seed takes seconds, not minutes. Deterministic: the same
 * rows every run, relative to today.
 *
 * Idempotent: the seed projects have fixed ids and are deleted (cascading to everything under
 * them) and recreated on every run, so `npm run db:seed` is safe to repeat and page URLs stay
 * stable. Nothing else in the database is touched — except the pre-rebuild "Acme Store" seed
 * website, which this replaces.
 *
 * Imports nothing from `src/` (whose server modules refuse to load outside Next.js), only the
 * generated client.
 *
 *   npm run db:seed --workspace @routely/web
 */

import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "../src/generated/prisma/client";

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to apps/web/.env first.");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const SEED_USER_EMAIL = "dev@routely.local";
const LEGACY_SEED_SITE_ID = "rt_000000000000000000000000000000ab";

/** Share of the prototype's daily traffic actually written. */
const SCALE = 0.5;
const DAY_MS = 86_400_000;
const NOW = Date.now();
const BATCH = 5_000;

// ---------------------------------------------------------------------------------------------
// Prototype constants
// ---------------------------------------------------------------------------------------------

const METRICS0 = [
  { key: "signup", name: "Sign up", lastMinAgo: 4, count24: 312 },
  { key: "lead", name: "Demo request", lastMinAgo: 2, count24: 174 },
  { key: "purchase", name: "Purchase", lastMinAgo: 12, count24: 86 },
  { key: "form_submit", name: "Newsletter form", lastMinAgo: 1, count24: 401 },
  { key: "cta_click", name: "Hero CTA click", lastMinAgo: 0.5, count24: 2210 },
  { key: "add_to_cart", name: "Add to cart", lastMinAgo: null, count24: 0 },
] as const;

/** Where the visual editor's canvas elements live on the seeded landing pages. */
const SELECTORS = {
  eyebrow: ".hero .eyebrow",
  headline: ".hero h1",
  sub: ".hero p.lead",
  cta: ".hero a.cta",
  trust: ".hero .trust",
  image: ".hero img",
} as const;
type El = keyof typeof SELECTORS;

interface ChangeSeed {
  el: El;
  prop: "text" | "bg" | "image";
  value: string;
}
interface ArmSeed {
  w: number;
  cr: number;
  url?: string;
  changes?: ChangeSeed[];
}
interface ExperimentSeed {
  key: string;
  name: string;
  type: "ab" | "redirect";
  status: "running" | "paused" | "draft" | "completed";
  url: string;
  /** Metric key, or "" for a URL goal. */
  goal: string;
  convUrl?: string;
  secondary?: string[];
  createdDaysAgo: number;
  updatedMinAgo: number;
  days?: number;
  perDay?: number;
  endedAgo?: number;
  winner?: number | null;
  hypothesis?: string;
  match?: "exact" | "wildcard";
  arms: ArmSeed[];
}

const KESTREL: ExperimentSeed[] = [
  {
    key: "e1",
    name: "Homepage hero — outcome-led headline",
    type: "ab",
    status: "running",
    url: "https://kestrelhq.com/",
    goal: "signup",
    secondary: ["form_submit"],
    createdDaysAgo: 19,
    updatedMinAgo: 42,
    days: 18,
    perDay: 2100,
    endedAgo: 0,
    hypothesis: "Leading with the outcome (speed) instead of the category will lift trial signups.",
    arms: [
      { w: 34, cr: 0.041 },
      {
        w: 33,
        cr: 0.0495,
        changes: [
          { el: "headline", prop: "text", value: "Ship projects 2× faster" },
          {
            el: "sub",
            prop: "text",
            value:
              "Kestrel keeps roadmaps, tasks and docs in sync, so your team spends less time updating and more time shipping.",
          },
        ],
      },
      {
        w: 33,
        cr: 0.043,
        changes: [
          { el: "headline", prop: "text", value: "Ship projects 2× faster" },
          { el: "cta", prop: "text", value: "Try it free for 14 days" },
          { el: "cta", prop: "bg", value: "#F0603F" },
        ],
      },
    ],
  },
  {
    key: "e2",
    name: "Demo page redesign (v2)",
    type: "redirect",
    status: "running",
    url: "https://kestrelhq.com/demo",
    goal: "lead",
    secondary: ["page_view"],
    createdDaysAgo: 12,
    updatedMinAgo: 180,
    days: 11,
    perDay: 640,
    endedAgo: 0,
    hypothesis: "A shorter page with the form above the fold will increase demo requests.",
    arms: [
      { w: 50, cr: 0.062, url: "https://kestrelhq.com/demo" },
      { w: 50, cr: 0.068, url: "https://kestrelhq.com/demo-v2" },
    ],
  },
  {
    key: "e3",
    name: "Pricing — annual billing by default",
    type: "ab",
    status: "running",
    url: "https://kestrelhq.com/pricing",
    goal: "purchase",
    createdDaysAgo: 6,
    updatedMinAgo: 300,
    days: 5,
    perDay: 900,
    endedAgo: 0,
    hypothesis: "Defaulting to annual billing increases paid conversions without hurting volume.",
    arms: [
      { w: 50, cr: 0.021 },
      {
        w: 50,
        cr: 0.0225,
        changes: [
          { el: "headline", prop: "text", value: "Save 20% with annual billing" },
          { el: "cta", prop: "text", value: "Get 20% off" },
        ],
      },
    ],
  },
  {
    key: "e4",
    name: "Free trial page — new layout",
    type: "redirect",
    status: "completed",
    url: "https://kestrelhq.com/trial",
    goal: "signup",
    createdDaysAgo: 30,
    updatedMinAgo: 8640,
    days: 21,
    perDay: 1600,
    endedAgo: 6,
    winner: 1,
    arms: [
      { w: 50, cr: 0.083, url: "https://kestrelhq.com/trial" },
      { w: 50, cr: 0.098, url: "https://kestrelhq.com/trial-new" },
    ],
  },
  {
    key: "e5",
    name: "Checkout — security badges",
    type: "ab",
    status: "paused",
    url: "https://kestrelhq.com/checkout",
    goal: "purchase",
    createdDaysAgo: 9,
    updatedMinAgo: 2880,
    days: 6,
    perDay: 180,
    endedAgo: 2,
    arms: [
      { w: 50, cr: 0.31 },
      {
        w: 50,
        cr: 0.322,
        changes: [
          { el: "trust", prop: "text", value: "256-bit SSL · SOC 2 Type II · Cancel anytime" },
        ],
      },
    ],
  },
  {
    key: "e6",
    name: "Paid social landing — short form",
    type: "redirect",
    status: "completed",
    url: "https://kestrelhq.com/lp/social",
    goal: "lead",
    createdDaysAgo: 44,
    updatedMinAgo: 21600,
    days: 24,
    perDay: 1500,
    endedAgo: 15,
    winner: 0,
    arms: [
      { w: 34, cr: 0.071, url: "https://kestrelhq.com/lp/social" },
      { w: 33, cr: 0.058, url: "https://kestrelhq.com/lp/social-short" },
      { w: 33, cr: 0.064, url: "https://kestrelhq.com/lp/social-quiz" },
    ],
  },
  {
    key: "e7",
    name: "Webinar page — CTA copy",
    type: "ab",
    status: "draft",
    url: "https://kestrelhq.com/webinars",
    goal: "form_submit",
    createdDaysAgo: 2,
    updatedMinAgo: 1440,
    arms: [
      { w: 50, cr: 0 },
      { w: 50, cr: 0, changes: [{ el: "cta", prop: "text", value: "Save my seat" }] },
    ],
  },
  {
    key: "e8",
    name: "Integrations hub — split test",
    type: "redirect",
    status: "draft",
    url: "https://kestrelhq.com/integrations",
    goal: "",
    createdDaysAgo: 1,
    updatedMinAgo: 95,
    arms: [
      { w: 50, cr: 0, url: "https://kestrelhq.com/integrations" },
      { w: 50, cr: 0, url: "https://kestrelhq.com/integrations-new" },
    ],
  },
  {
    key: "e9",
    name: "Blog — sticky trial bar",
    type: "ab",
    status: "completed",
    url: "https://kestrelhq.com/blog/*",
    goal: "signup",
    match: "wildcard",
    createdDaysAgo: 62,
    updatedMinAgo: 43200,
    days: 28,
    perDay: 1200,
    endedAgo: 30,
    winner: null,
    arms: [
      { w: 50, cr: 0.012 },
      {
        w: 50,
        cr: 0.0124,
        changes: [{ el: "eyebrow", prop: "text", value: "Sticky bar: Try Kestrel free →" }],
      },
    ],
  },
];

/** The prototype's `buildAlt()`: Northwind reuses e1/e2/e4/e7 with its own names and URLs. */
function northwind(): ExperimentSeed[] {
  const rename: Record<string, [string, string]> = {
    e1: ["Homepage hero — seasonal blend", "https://northwindcoffee.com/"],
    e2: ["Subscription page — new layout", "https://northwindcoffee.com/subscribe"],
    e4: ["Gift cards — landing page split", "https://northwindcoffee.com/gifts"],
    e7: ["Wholesale page — CTA copy", "https://northwindcoffee.com/wholesale"],
  };
  const changes: Record<string, ChangeSeed[][]> = {
    e1: [
      [{ el: "headline", prop: "text", value: "Small-batch coffee, roasted this week" }],
      [
        { el: "headline", prop: "text", value: "Small-batch coffee, roasted this week" },
        { el: "cta", prop: "text", value: "Start a subscription" },
      ],
    ],
    e7: [[{ el: "cta", prop: "text", value: "Request wholesale pricing" }]],
  };
  const volume: Record<string, number> = { e1: 0.62, e2: 0.8, e4: 0.7, e7: 1 };

  return KESTREL.filter((e) => rename[e.key]).map((e) => {
    const [name, url] = rename[e.key]!;
    const arms = e.arms.map((arm, i) => ({
      w: arm.w,
      cr: arm.cr * [1, 1.04, 0.97][i % 3]! * (e.key === "e1" ? 1.35 : 1.1),
      ...(e.type === "redirect"
        ? { url: i ? `${url.replace(/\/$/, "")}-v${i + 1}` : url }
        : { changes: i ? (changes[e.key]?.[i - 1] ?? changes[e.key]?.[0] ?? arm.changes) : [] }),
    }));
    return {
      ...e,
      key: `nw${e.key}`,
      name,
      url,
      arms,
      hypothesis: "",
      perDay: Math.round((e.perDay ?? 0) * (volume[e.key] ?? 1)),
      // The subscription test is judged on reaching the thank-you page: the URL-goal path.
      ...(e.key === "e2"
        ? { goal: "", convUrl: "https://northwindcoffee.com/subscribe/thank-you", secondary: [] }
        : { secondary: [] }),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Deterministic traffic (the prototype's generator)
// ---------------------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** `daily[arm][day] = { v, c }` — the prototype's `genDaily`. */
function genDaily(seed: number, days: number, arms: ArmSeed[], perDay: number) {
  const r = rng(seed);
  return arms.map((arm) =>
    Array.from({ length: days }, (_, i) => {
      const wk = 1 + 0.16 * Math.sin((i + (seed % 7)) * 0.9);
      const v = Math.max(1, Math.round(((perDay * arm.w) / 100) * wk * (0.85 + r() * 0.3)));
      return { v, c: Math.round(v * arm.cr * (0.8 + r() * 0.4)) };
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Time zones (inlined: the seed imports nothing from src/)
// ---------------------------------------------------------------------------------------------

function dayKey(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/** Start of the project-local day `n` days before today, as epoch ms. */
function localDayStart(daysAgo: number, timeZone: string): number {
  const target = dayKey(NOW - daysAgo * DAY_MS, timeZone);
  // Walk back from the target's UTC midnight ± 14 h to the first instant on that local day.
  let t = Date.parse(`${target}T00:00:00Z`) - 14 * 3_600_000;
  while (dayKey(t, timeZone) !== target) t += 15 * 60_000;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

async function createInBatches<T>(rows: T[], write: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH));
}

interface ProjectSeed {
  id: string;
  name: string;
  domain: string;
  extraDomains: string[];
  publicSiteId: string;
  createdDaysAgo: number;
  installed: boolean;
  cdnPurgedAt: Date | null;
  hits: boolean;
  members: { name: string; email: string; role: "EDITOR" | "VIEWER" }[];
  experiments: ExperimentSeed[];
  iconUrl: string | null;
}

const TIME_ZONE = "America/New_York";

async function seedProject(
  userId: string,
  ownerName: string,
  project: ProjectSeed,
  seedOffset: number,
) {
  const created = new Date(NOW - project.createdDaysAgo * DAY_MS);

  await db.website.create({
    data: {
      id: project.id,
      userId,
      name: project.name,
      domain: project.domain,
      publicSiteId: project.publicSiteId,
      timezone: TIME_ZONE,
      significanceThreshold: 95,
      iconUrl: project.iconUrl,
      installMethod: "MANUAL",
      pixelVerifiedAt: project.installed ? new Date(NOW - 3 * DAY_MS) : null,
      cdnPurgedAt: project.cdnPurgedAt,
      createdAt: created,
      domains: { create: project.extraDomains.map((domain) => ({ domain, createdAt: created })) },
      members: {
        create: project.members.map((m, i) => ({
          ...m,
          createdAt: new Date(created.getTime() + (i + 1) * DAY_MS),
        })),
      },
    },
  });

  // Metrics: the system page_view plus the prototype's six.
  const metricIds = new Map<string, string>();
  const pageView = await db.metric.create({
    data: {
      id: `${project.id}_m_page_view`,
      websiteId: project.id,
      name: "Page view",
      kind: "PAGE_VISIT",
      key: "page_view",
      system: true,
      createdAt: created,
    },
  });
  metricIds.set("page_view", pageView.id);
  for (const metric of METRICS0) {
    const row = await db.metric.create({
      data: {
        id: `${project.id}_m_${metric.key}`,
        websiteId: project.id,
        name: metric.name,
        kind: "CUSTOM_EVENT",
        key: metric.key,
        createdAt: created,
      },
    });
    metricIds.set(metric.key, row.id);
  }

  // Metric hits: the prototype's 24-hour counts, ending at its "last received" times, plus a
  // thinner tail over the previous week so older history exists.
  const hits: Prisma.MetricHitCreateManyInput[] = [];
  if (project.hits) {
    const r = rng(seedOffset + 7);
    for (const metric of METRICS0) {
      if (metric.lastMinAgo === null) continue;
      const metricId = metricIds.get(metric.key)!;
      const last = NOW - metric.lastMinAgo * 60_000;
      const count = Math.round(metric.count24 * SCALE);
      for (let i = 0; i < count; i += 1) {
        const at = i === 0 ? last : last - r() * (DAY_MS - metric.lastMinAgo * 60_000);
        hits.push({
          websiteId: project.id,
          metricId,
          occurredAt: new Date(at),
          url: `https://${project.domain}/`,
        });
      }
      for (let i = 0; i < Math.round(count / 3); i += 1) {
        hits.push({
          websiteId: project.id,
          metricId,
          occurredAt: new Date(NOW - DAY_MS - r() * 6 * DAY_MS),
          url: `https://${project.domain}/`,
        });
      }
    }
  }
  await createInBatches(hits, (data) => db.metricHit.createMany({ data }));

  let totals = { experiments: 0, assignments: 0, conversions: 0, events: 0 };

  for (const [index, e] of project.experiments.entries()) {
    const stats = await seedExperiment(userId, ownerName, project, e, index, seedOffset, metricIds);
    totals = {
      experiments: totals.experiments + 1,
      assignments: totals.assignments + stats.assignments,
      conversions: totals.conversions + stats.conversions,
      events: totals.events + stats.events,
    };
  }

  return { metrics: metricIds.size, hits: hits.length, members: project.members.length, ...totals };
}

async function seedExperiment(
  userId: string,
  ownerName: string,
  project: ProjectSeed,
  e: ExperimentSeed,
  index: number,
  seedOffset: number,
  metricIds: Map<string, string>,
) {
  const id = `${project.id}_${e.key}`;
  const days = e.days ?? 0;
  const endedAgo = e.endedAgo ?? 0;
  const isAb = e.type === "ab";
  const status = { running: "ACTIVE", paused: "PAUSED", draft: "DRAFT", completed: "ARCHIVED" }[
    e.status
  ] as "ACTIVE" | "PAUSED" | "DRAFT" | "ARCHIVED";

  const firstDayAgo = endedAgo + days - 1;
  const publishedAt = days ? new Date(localDayStart(firstDayAgo, TIME_ZONE) + 9 * 3_600_000) : null;
  const stoppedAt =
    e.status === "completed" ? new Date(localDayStart(endedAgo, TIME_ZONE) + 17 * 3_600_000) : null;
  const goalMetricId = e.goal ? metricIds.get(e.goal)! : null;
  const secondary = (e.secondary ?? []).map((k) => metricIds.get(k)!).filter(Boolean);
  const createdAt = new Date(NOW - e.createdDaysAgo * DAY_MS);
  const testUrl = e.url.replace("*", "how-to-plan-a-roadmap");

  await db.experiment.create({
    data: {
      id,
      websiteId: project.id,
      name: e.name,
      description: e.hypothesis || null,
      type: isAb ? "AB" : "SPLIT_URL",
      controlUrl: e.url,
      controlMatchType: "EXACT",
      controlWeight: e.arms[0]!.w,
      targeting: {
        match: e.match ?? "exact",
        pattern: e.url,
        testUrl,
        audience: "all",
        devices: ["desktop", "tablet", "mobile"],
        geo: "all",
        geoMode: "include",
        countries: [],
        logic: "all",
        conditions: [],
      },
      trafficAllocation: 100,
      conversionUrl: e.goal ? null : (e.convUrl ?? null),
      goalMetricId,
      secondaryMetricIds: secondary,
      countingMode: "UNIQUE",
      status,
      winnerPosition: e.status === "completed" ? (e.winner ?? null) : null,
      keepWinner: false,
      publishedAt,
      stoppedAt,
      createdAt,
      updatedAt: new Date(NOW - e.updatedMinAgo * 60_000),
      variants: {
        create: e.arms.slice(1).map((arm, i) => ({
          id: `${id}_v${i + 1}`,
          position: i + 1,
          url: isAb ? "" : (arm.url ?? ""),
          weight: arm.w,
          changes: isAb
            ? (arm.changes ?? []).map((c) => ({
                selector: SELECTORS[c.el],
                prop: c.prop,
                value: c.value,
                el: c.el,
              }))
            : [],
        })),
      },
    },
  });

  // Activity, oldest first (the timeline reads newest first).
  const marcus = project.members.find((m) => m.role === "EDITOR")?.name ?? ownerName;
  const activity: Prisma.ExperimentActivityCreateManyInput[] = [
    {
      experimentId: id,
      actorName: index % 2 ? marcus : ownerName,
      text: e.status === "draft" ? "Experiment created as draft" : "Experiment created",
      createdAt,
    },
  ];
  if (publishedAt) {
    activity.push({
      experimentId: id,
      actorName: ownerName,
      text: "Launched to 100% of matching traffic",
      createdAt: publishedAt,
    });
  }
  if (e.status === "paused") {
    activity.push({
      experimentId: id,
      actorName: marcus,
      text: "Experiment paused",
      createdAt: new Date(localDayStart(endedAgo, TIME_ZONE) + 10 * 3_600_000),
    });
  }
  if (e.status === "completed" && stoppedAt) {
    activity.push({
      experimentId: id,
      actorName: ownerName,
      text:
        e.winner == null
          ? "Ended with no clear winner"
          : `Ended · ${["Control", "Variant A", "Variant B", "Variant C", "Variant D"][e.winner]} declared winner`,
      createdAt: stoppedAt,
    });
  }
  await db.experimentActivity.createMany({ data: activity });

  if (!days || !e.perDay) return { assignments: 0, conversions: 0, events: 0 };

  // Traffic.
  const daily = genDaily(index * 977 + 13 + seedOffset, days, e.arms, Math.round(e.perDay * SCALE));
  const r = rng(index * 131 + 17 + seedOffset);
  const visitors: Prisma.VisitorCreateManyInput[] = [];
  const assignments: Prisma.AssignmentCreateManyInput[] = [];
  const events: Prisma.EventCreateManyInput[] = [];
  const conversions: Prisma.ConversionCreateManyInput[] = [];
  const primaryKey = goalMetricId ?? "url";
  const goalUrl = e.convUrl ?? `https://${project.domain}/thank-you`;
  let n = 0;

  for (let d = 0; d < days; d += 1) {
    const dayAgo = firstDayAgo - d;
    const start = localDayStart(dayAgo, TIME_ZONE);
    // Today is only partly over: keep every timestamp in the past.
    const span = Math.max(60_000, Math.min(DAY_MS, NOW - start - 60_000));

    e.arms.forEach((arm, armIndex) => {
      const { v, c } = daily[armIndex]![d]!;
      const variantId = armIndex === 0 ? null : `${id}_v${armIndex}`;
      const pageUrl = isAb
        ? e.url.replace("*", "how-to-plan-a-roadmap")
        : armIndex === 0
          ? e.url
          : arm.url!;

      for (let i = 0; i < v; i += 1) {
        n += 1;
        const visitorId = `${id}_vis${n}`;
        const assignmentId = `${id}_a${n}`;
        const at = start + r() * span;
        visitors.push({
          id: visitorId,
          websiteId: project.id,
          anonymousId: `seed-${id}-${n}`,
          firstSeenAt: new Date(at),
          lastSeenAt: new Date(at),
          createdAt: new Date(at),
        });
        assignments.push({
          id: assignmentId,
          experimentId: id,
          visitorId,
          variantId,
          assignedAt: new Date(at),
          createdAt: new Date(at),
        });
        const base = {
          websiteId: project.id,
          experimentId: id,
          visitorId,
          assignmentId,
          variantId,
        };
        events.push({ ...base, type: "page_view", url: pageUrl, occurredAt: new Date(at) });
        if (r() < 0.6) {
          events.push({
            ...base,
            type: "time_on_page",
            url: pageUrl,
            durationMs: Math.round(4_000 + r() * 90_000),
            occurredAt: new Date(Math.min(at + 30_000, NOW - 1_000)),
          });
        }

        const converts = i < c;
        const convertsSecondary = secondary.length > 0 && r() < arm.cr * (0.55 + armIndex * 0.04);
        const convertedAt = new Date(Math.min(at + 60_000 + r() * 1_800_000, NOW - 1_000));
        if (converts) {
          conversions.push({
            experimentId: id,
            visitorId,
            assignmentId,
            variantId,
            url: goalUrl,
            goalKey: primaryKey,
            occurredAt: convertedAt,
          });
          events.push({
            ...base,
            type: "conversion",
            url: goalUrl,
            goalKey: primaryKey,
            occurredAt: convertedAt,
          });
          // A tenth convert twice — what "count every conversion" counts and "unique" does not.
          if (r() < 0.1) {
            events.push({
              ...base,
              type: "conversion",
              url: goalUrl,
              goalKey: primaryKey,
              occurredAt: new Date(Math.min(convertedAt.getTime() + 600_000, NOW - 500)),
            });
          }
        }
        if (convertsSecondary) {
          for (const goalKey of secondary) {
            conversions.push({
              experimentId: id,
              visitorId,
              assignmentId,
              variantId,
              url: pageUrl,
              goalKey,
              occurredAt: convertedAt,
            });
            events.push({
              ...base,
              type: "conversion",
              url: pageUrl,
              goalKey,
              occurredAt: convertedAt,
            });
          }
        }
      }
    });
  }

  await createInBatches(visitors, (data) => db.visitor.createMany({ data }));
  await createInBatches(assignments, (data) => db.assignment.createMany({ data }));
  await createInBatches(events, (data) => db.event.createMany({ data }));
  await createInBatches(conversions, (data) => db.conversion.createMany({ data }));

  return {
    assignments: assignments.length,
    conversions: conversions.length,
    events: events.length,
  };
}

async function main() {
  const started = Date.now();
  const user = await db.user.upsert({
    where: { email: SEED_USER_EMAIL },
    create: { email: SEED_USER_EMAIL, name: "Local Developer" },
    update: {},
  });
  const ownerName = user.name?.trim() || user.email;

  const projects: ProjectSeed[] = [
    {
      id: "seed_kestrel",
      name: "Kestrel",
      domain: "kestrelhq.com",
      extraDomains: ["app.kestrelhq.com"],
      publicSiteId: "rt_seedkestrel0000000000000000000001",
      createdDaysAgo: 210,
      installed: true,
      cdnPurgedAt: new Date(localDayStart(2, TIME_ZONE) + 14 * 3_600_000 + 12 * 60_000),
      hits: true,
      iconUrl: null,
      members: [
        { name: "Marcus Lee", email: "marcus@kestrelhq.com", role: "EDITOR" },
        { name: "Priya Raman", email: "priya@rightleftagency.com", role: "EDITOR" },
        { name: "Tom Becker", email: "tom@kestrelhq.com", role: "VIEWER" },
      ],
      experiments: KESTREL,
    },
    {
      id: "seed_northwind",
      name: "Northwind Coffee",
      domain: "northwindcoffee.com",
      extraDomains: [],
      publicSiteId: "rt_seednorthwind00000000000000000002",
      createdDaysAgo: 96,
      installed: true,
      cdnPurgedAt: new Date(localDayStart(1, TIME_ZONE) + 9 * 3_600_000 + 40 * 60_000),
      hits: true,
      iconUrl: null,
      members: [],
      experiments: northwind(),
    },
    {
      id: "seed_lumen",
      name: "Lumen Studio",
      domain: "lumenstudio.io",
      extraDomains: [],
      publicSiteId: "rt_seedlumen0000000000000000000000003",
      createdDaysAgo: 4,
      installed: false,
      cdnPurgedAt: null,
      hits: false,
      iconUrl: null,
      members: [],
      experiments: [],
    },
  ];

  // Idempotency: remove the previous run's seed projects (cascades to everything under them)
  // and the pre-rebuild Acme seed, then recreate.
  await db.website.deleteMany({
    where: {
      OR: [
        { id: { in: projects.map((p) => p.id) } },
        { publicSiteId: { in: [LEGACY_SEED_SITE_ID, ...projects.map((p) => p.publicSiteId)] } },
      ],
    },
  });

  for (const [i, project] of projects.entries()) {
    const counts = await seedProject(user.id, ownerName, project, i * 1009);
    console.log(
      `  ${project.name.padEnd(17)} ${String(counts.experiments).padStart(2)} experiments · ${counts.assignments} assignments · ${counts.conversions} conversions · ${counts.events} events · ${counts.metrics} metrics · ${counts.hits} metric hits · ${counts.members} members`,
    );
  }

  console.log(
    `Seeded ${projects.length} projects for ${user.email} in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

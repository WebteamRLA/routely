/**
 * Demo seed: the design prototype's workspace, as real rows.
 *
 * `npm run db:seed` builds the "Fernwood Group" workspace the routely-design-main prototype shows —
 * its five members and pending invite, the three projects (Fernwood Supply, Fernwood Journal,
 * Kestrel Outdoor), all seventeen experiments with their variants, visual changes, activity and
 * per-arm visitors and conversions, 90 days of site visitors behind every sparkline, and page
 * traffic behind the wizards' estimates — so each real screen can be compared with the design's.
 *
 * ## Time
 *
 * The prototype is pinned to Tuesday Oct 13, 2026, 09:30 (its "now": every "day 21", "4 min ago",
 * "Today, 9:12 AM" and "Expires in 5 days" is measured from that moment). The seed replays that
 * timeline shifted by `now − DESIGN_NOW`, so at the moment it runs every relative reading — day
 * numbers, ages, "just now", invite expiry, the order of every list — is the design's. Calendar
 * labels read correspondingly later ("Running since Sep 28" for the design's "Sep 22" when run on
 * Oct 19), and clock times move by the difference between the run's time of day and 09:30.
 * Dates the design only ever shows as a calendar date and that nothing relative depends on —
 * project creation, the password's last change, two members' last activity, one signed-in
 * device — are kept verbatim (`onDate`). Run it again to bring the relative readings back.
 *
 * ## Idempotent, and scoped to its own rows
 *
 * Every row has a fixed id (`demo_…`) or a fixed natural key (the demo emails, `demo-…` anonymous
 * ids), and a run converges on the same state: identity rows are upserted, and the generated
 * traffic of the demo experiments and websites is deleted and rewritten in one transaction (it
 * has to be — it moves with the clock). Nothing outside the demo workspace is read or written.
 *
 * Builds its own Prisma client and imports nothing from `src/` (CLAUDE.md §9); the two pure rules
 * it needs — the password hash format of `lib/password.ts` and `normalizeUrl` of `lib/url.ts` —
 * are restated below. `npm run db:seed` refuses to run unless DATABASE_URL is local.
 *
 *   npm run db:seed
 */

import "dotenv/config";

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to apps/web/.env first.");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The prototype's "now": Oct 13, 2026, 09:30 UTC. */
const DESIGN_NOW = Date.UTC(2026, 9, 13, 9, 30);
const NOW = Date.now();
const SHIFT = NOW - DESIGN_NOW;

/** A moment of the design's 2026 timeline (month 1–12, UTC clock), moved so its "now" is now. */
function at(month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(Date.UTC(2026, month - 1, day, hour, minute) + SHIFT);
}

/** A calendar-only date, kept verbatim. Noon UTC, so no viewer time zone moves it a day. */
function onDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function ago(ms: number): Date {
  return new Date(NOW - ms);
}

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Pure helpers restated from src/ (keep in step with lib/password.ts and lib/url.ts)
// ---------------------------------------------------------------------------------------------

/** lib/password.ts: `scrypt$N$r$p$<salt>$<hash>`, base64url, N = 2^15, r = 8, p = 1. */
const SCRYPT = { N: 32_768, r: 8, p: 1 } as const;

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      keylen,
      { N, r, p, maxmem: 128 * N * r * 2 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, 32);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

async function passwordMatches(password: string, encoded: string | null): Promise<boolean> {
  const parts = encoded?.split("$") ?? [];
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (N !== SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) return false;
  const hash = Buffer.from(parts[5]!, "base64url");
  const key = await derive(password, Buffer.from(parts[4]!, "base64url"), N, r, p, hash.length);
  return key.length === hash.length && timingSafeEqual(key, hash);
}

/** lib/url.ts `normalizeUrl` for the plain URLs used here: no query, no trailing slash. */
function urlKey(url: string): string {
  const u = new URL(url);
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  return `${u.protocol}//${u.host.toLowerCase()}${path}`;
}

/** Deterministic PRNG (mulberry32), seeded from a string, so a run's shapes are reproducible. */
function prng(seedText: string): () => number {
  let a = 0;
  for (const ch of seedText) a = (Math.imul(a, 31) + ch.charCodeAt(0)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits `total` across `weights` exactly (largest remainder). */
function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, n) => s + n, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]![1]]! += 1;
  return out;
}

// ---------------------------------------------------------------------------------------------
// The design's data
// ---------------------------------------------------------------------------------------------

/** Shared by every demo account so each role can be tried. Printed at the end. */
const DEMO_PASSWORD = "fernwood-demo-2026";

const WORKSPACE_ID = "demo_ws_fernwood";
const WORKSPACE_NAME = "Fernwood Group";

type UserKey = "alex" | "jamie" | "priya" | "marcus" | "dana";
type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

interface UserSpec {
  id: string;
  name: string;
  email: string;
  role: Role;
  joined: Date;
  lastActive: Date;
}

/** Settings → Team, in the design's order (Owner, then by join date). */
const USERS: Record<UserKey, UserSpec> = {
  alex: {
    id: "demo_user_alex",
    name: "Alex Morgan",
    email: "alex@fernwoodsupply.com",
    role: "OWNER",
    joined: onDate(2025, 3, 1),
    lastActive: new Date(NOW), // "Active now"
  },
  jamie: {
    id: "demo_user_jamie",
    name: "Jamie Lee",
    email: "jamie@fernwoodsupply.com",
    role: "ADMIN",
    joined: onDate(2025, 3, 3),
    lastActive: at(10, 13, 9, 12), // "Today, 9:12 AM"
  },
  priya: {
    id: "demo_user_priya",
    name: "Priya Shah",
    email: "priya@fernwoodsupply.com",
    role: "EDITOR",
    joined: onDate(2025, 5, 12),
    lastActive: at(10, 12, 16, 40), // "Yesterday, 4:40 PM"
  },
  marcus: {
    id: "demo_user_marcus",
    name: "Marcus Webb",
    email: "marcus@northbeamstudio.com",
    role: "EDITOR",
    joined: onDate(2025, 11, 3),
    lastActive: onDate(2026, 10, 8),
  },
  dana: {
    id: "demo_user_dana",
    name: "Dana Ortiz",
    email: "dana@fernwoodsupply.com",
    role: "VIEWER",
    joined: onDate(2026, 2, 16),
    lastActive: onDate(2026, 9, 30),
  },
};

/** "Last changed Aug 2, 2026." */
const ALEX_PASSWORD_CHANGED = onDate(2026, 8, 2);

const INVITE = {
  id: "demo_inv_sam",
  email: "sam@fernwoodsupply.com",
  role: "EDITOR" as const,
  sentAt: at(10, 11, 9, 0), // "Oct 11" · "Expires in 5 days"
};

/** Settings → "Where you're signed in", besides the session the viewer signs in with. */
const SESSIONS = [
  {
    id: "demo_sess_iphone",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    city: "Portland",
    country: "US",
    createdAt: at(10, 1, 8, 0),
    lastSeenAt: ago(2 * HOUR), // "2 hours ago"
  },
  {
    id: "demo_sess_edge",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    city: "Seattle",
    country: "US",
    createdAt: onDate(2026, 9, 21),
    lastSeenAt: onDate(2026, 10, 9), // "Oct 9, 2026"
  },
];

type SiteKey = "fernwood" | "journal" | "kestrel";

interface SiteSpec {
  id: string;
  name: string;
  domain: string;
  publicSiteId: string;
  /**
   * `PROJECT_PALETTE` slot. Fernwood's green is slot 2; the design's orange (Journal) and purple
   * (Kestrel) tiles are not in the app's five-colour palette, so the nearest slots stand in.
   */
  colorIndex: number;
  createdAt: Date;
  createdBy: UserKey;
  pixelVerifiedAt: Date | null;
  lastSeenAt: Date | null;
  trackingAlertSentAt: Date | null;
  /** Daily visitors, oldest first, 90 days ending today; null for none. */
  series: number[] | null;
  /** Pages with a traffic baseline (visitors/day over the last 30 days). */
  pages: { url: string; perDay: number }[];
}

const F = "https://fernwoodsupply.com";
const J = "https://journal.fernwoodsupply.com";

/**
 * The design's visitor generator (`visitorSeries` in its ProjectDashboard/Main seed): 90 days
 * ending on its "today", scaled so the last 30 sum to the project's 30-day total exactly. Placed
 * index for index on the 90 days ending today, so every sparkline and chart has the design's shape.
 */
function designSeries(cfg: { seed: number; base: number; slope: number; total: number }) {
  let seed = cfg.seed;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const raw: number[] = [];
  for (let i = 89; i >= 0; i--) {
    const dow = new Date(2026, 9, 13 - i).getDay();
    const wk = dow === 0 || dow === 6 ? 0.74 : dow === 1 ? 1.05 : 1;
    raw.push((cfg.base + (89 - i) * cfg.slope) * wk * (0.93 + rnd() * 0.14));
  }
  const last = raw.slice(60).reduce((a, v) => a + v, 0);
  const k = cfg.total / last;
  const out = raw.map((v) => Math.round(v * k));
  const sum30 = out.slice(60).reduce((a, v) => a + v, 0);
  out[89]! += cfg.total - sum30;
  return out;
}

const SITES: Record<SiteKey, SiteSpec> = {
  fernwood: {
    id: "demo_fernwood",
    name: "Fernwood Supply",
    domain: "fernwoodsupply.com",
    publicSiteId: "rt_fernwoodsupplydemo0000004821",
    colorIndex: 2,
    createdAt: onDate(2025, 3, 4),
    createdBy: "alex",
    pixelVerifiedAt: onDate(2025, 3, 4),
    // "Not seen" · "Last seen 25 days ago". The design keeps counting visitors and running
    // experiments regardless; so does this seed.
    lastSeenAt: at(9, 18, 7, 30),
    trackingAlertSentAt: at(9, 19, 7, 30),
    series: designSeries({ seed: 1013, base: 860, slope: 6, total: 48210 }),
    pages: [
      { url: `${F}/`, perDay: 1240 },
      { url: `${F}/cart`, perDay: 1240 },
      { url: `${F}/collections/all`, perDay: 1240 },
    ],
  },
  journal: {
    id: "demo_journal",
    name: "Fernwood Journal",
    domain: "journal.fernwoodsupply.com",
    publicSiteId: "rt_fernwoodjournaldemo000001937",
    colorIndex: 3,
    createdAt: onDate(2025, 6, 18),
    createdBy: "alex",
    pixelVerifiedAt: onDate(2025, 6, 18),
    lastSeenAt: ago(4 * MINUTE), // "Active" · "Last seen 4 min ago"
    trackingAlertSentAt: null,
    series: designSeries({ seed: 2207, base: 150, slope: 1.1, total: 6940 }),
    pages: [{ url: `${J}/articles/gear-care-101`, perDay: 80 }],
  },
  kestrel: {
    id: "demo_kestrel",
    name: "Kestrel Outdoor",
    domain: "kestreloutdoor.co",
    publicSiteId: "rt_kestreloutdoordemo0000007720",
    colorIndex: 1,
    createdAt: onDate(2026, 10, 9),
    createdBy: "jamie",
    pixelVerifiedAt: null, // "Not installed"
    lastSeenAt: null,
    trackingAlertSentAt: null,
    series: null,
    pages: [],
  },
};

type Kind = "heading" | "text" | "button" | "image";

/** One `validation/visual-change.ts` change. An empty label lets the summary name the kind. */
function change(
  id: string,
  kind: Kind,
  label: string,
  selector: string,
  original: { text?: string; src?: string; alt?: string },
  set: { text?: string; src?: string },
) {
  const tag = selector.endsWith(" h2")
    ? "h2"
    : { heading: "h1", text: "p", button: "button", image: "img" }[kind];
  const fingerprint = {
    tag,
    ...(original.text !== undefined ? { text: original.text } : {}),
    ...(original.src !== undefined ? { src: original.src } : {}),
  };
  return { id, selector, kind, label, fingerprint, original, set };
}

const HERO_HEADING = "Gear up for fall";

type Status = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
type ActivityType = "CREATED" | "LAUNCHED" | "PAUSED" | "ENDED" | "RESULT_READY";

interface ArmSpec {
  name: string;
  weight: number;
  url?: string;
  changes?: ReturnType<typeof change>[];
  visitors: number;
  conversions: number;
}

interface ExperimentSpec {
  /** The design's id (e5, n1…). */
  key: string;
  /** Chosen so `tileFor(id)` picks the design's tile colour (its `TILES[n % 6]`). */
  id: string;
  site: SiteKey;
  type: "SPLIT_URL" | "AB_TEST";
  name: string;
  status: Status;
  controlUrl: string;
  controlMatch?: "EXACT" | "PREFIX";
  goalUrl: string | null;
  include: number;
  devices?: ("DESKTOP" | "MOBILE" | "TABLET")[];
  wizardStep?: number;
  createdBy: UserKey;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  pausedAt?: Date;
  endedAt?: Date;
  resultReadyAt?: Date;
  /** The design's chart length, whose deterministic wander the cumulative rates follow. */
  designDays?: number;
  share?: boolean;
  control: { weight: number; visitors: number; conversions: number };
  variants: ArmSpec[];
  activity: [ActivityType, UserKey | null, Date][];
}

const EXPERIMENTS: ExperimentSpec[] = [
  {
    key: "e1",
    id: "demo_e1c",
    site: "fernwood",
    type: "SPLIT_URL",
    name: "Pricing page layout",
    status: "PAUSED",
    controlUrl: `${F}/pricing`,
    goalUrl: `${F}/checkout`,
    include: 40,
    createdBy: "jamie",
    createdAt: at(9, 29, 10, 0),
    publishedAt: at(10, 1, 17, 0),
    pausedAt: at(10, 10, 16, 20),
    updatedAt: at(10, 10, 16, 20),
    designDays: 9,
    control: { weight: 50, visitors: 1972, conversions: 40 },
    variants: [
      { name: "Variant", weight: 50, url: `${F}/pricing-b`, visitors: 1968, conversions: 43 },
    ],
    activity: [
      ["CREATED", "jamie", at(9, 29, 10, 0)],
      ["LAUNCHED", "jamie", at(10, 1, 17, 0)],
      ["PAUSED", "jamie", at(10, 10, 16, 20)],
    ],
  },
  {
    key: "e2",
    id: "demo_e2c",
    site: "fernwood",
    type: "AB_TEST",
    name: "Homepage hero video",
    status: "ACTIVE",
    controlUrl: `${F}/`,
    goalUrl: `${F}/collections/all`,
    include: 100,
    createdBy: "priya",
    createdAt: at(10, 6, 11, 0),
    publishedAt: at(10, 8, 9, 0),
    updatedAt: at(10, 13, 9, 12),
    control: { weight: 50, visitors: 0, conversions: 0 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 0,
        conversions: 0,
        changes: [
          change(
            "c1",
            "image",
            "Hero image",
            "#hero img",
            {
              src: "https://cdn.fernwoodsupply.com/images/hero-autumn-trail.jpg",
              alt: "Hiker on an autumn trail",
            },
            { src: "https://cdn.fernwoodsupply.com/images/hero-trail-loop.webp" },
          ),
          change(
            "c2",
            "heading",
            "",
            "#hero h1",
            { text: HERO_HEADING },
            { text: "See where your gear can take you" },
          ),
        ],
      },
    ],
    activity: [
      ["CREATED", "priya", at(10, 6, 11, 0)],
      ["LAUNCHED", "priya", at(10, 8, 9, 0)],
    ],
  },
  {
    key: "e3",
    id: "demo_e3c",
    site: "fernwood",
    type: "AB_TEST",
    name: "Free shipping banner",
    status: "DRAFT",
    controlUrl: `${F}/cart`,
    goalUrl: `${F}/checkout`,
    include: 100,
    wizardStep: 5,
    createdBy: "priya",
    createdAt: at(10, 12, 10, 30),
    updatedAt: at(10, 12, 16, 5),
    control: { weight: 50, visitors: 0, conversions: 0 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 0,
        conversions: 0,
        changes: [
          change(
            "c1",
            "text",
            "Banner text",
            ".announcement-bar p",
            { text: "Free returns on every order" },
            { text: "Free shipping on orders over $75" },
          ),
          change(
            "c2",
            "button",
            "",
            "#cart-checkout",
            { text: "Check out" },
            { text: "Check out with free shipping" },
          ),
        ],
      },
    ],
    activity: [["CREATED", "priya", at(10, 12, 10, 30)]],
  },
  {
    key: "e4",
    id: "demo_e4c",
    site: "fernwood",
    type: "AB_TEST",
    name: "Collection page filters",
    status: "DRAFT",
    controlUrl: `${F}/collections/all`,
    goalUrl: null, // "Add a goal page to finish setup" → Setup incomplete
    include: 100,
    devices: ["DESKTOP", "MOBILE"],
    wizardStep: 4,
    createdBy: "priya",
    createdAt: at(10, 7, 15, 0),
    updatedAt: at(10, 9, 14, 48),
    control: { weight: 50, visitors: 0, conversions: 0 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 0,
        conversions: 0,
        changes: [
          change(
            "c1",
            "heading",
            "Hero heading",
            "#collection-hero h1",
            { text: "All gear" },
            { text: "Find gear by activity" },
          ),
          change(
            "c2",
            "heading",
            "Section heading",
            "#collection-grid h2",
            { text: "Bestsellers this week" },
            { text: "Filter by trail, camp or climb" },
          ),
        ],
      },
    ],
    activity: [["CREATED", "priya", at(10, 7, 15, 0)]],
  },
  {
    key: "e5",
    id: "demo_e5c",
    site: "fernwood",
    type: "AB_TEST",
    name: "Homepage hero headline",
    status: "ACTIVE",
    controlUrl: `${F}/`,
    goalUrl: `${F}/collections/all`,
    include: 50,
    createdBy: "alex",
    createdAt: at(9, 20, 11, 0),
    publishedAt: at(9, 22, 13, 10),
    updatedAt: at(9, 22, 13, 10),
    resultReadyAt: at(10, 6, 14, 0),
    designDays: 21,
    share: true,
    control: { weight: 50, visitors: 6240, conversions: 218 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 6240,
        conversions: 256,
        changes: [
          change(
            "c1",
            "heading",
            "",
            "#hero h1",
            { text: HERO_HEADING },
            { text: "Built for the trail. Priced for the season." },
          ),
        ],
      },
    ],
    activity: [
      ["CREATED", "alex", at(9, 20, 11, 0)],
      ["LAUNCHED", "alex", at(9, 22, 13, 10)],
      ["RESULT_READY", null, at(10, 6, 14, 0)],
    ],
  },
  {
    key: "e6",
    id: "demo_e6c",
    site: "fernwood",
    type: "SPLIT_URL",
    name: "One-page checkout",
    status: "ACTIVE",
    controlUrl: `${F}/checkout`,
    goalUrl: `${F}/checkout/thank-you`,
    include: 100,
    createdBy: "jamie",
    createdAt: at(9, 26, 10, 0),
    publishedAt: at(9, 29, 9, 40),
    updatedAt: at(9, 29, 9, 40),
    resultReadyAt: at(10, 12, 15, 0),
    designDays: 14,
    control: { weight: 50, visitors: 4110, conversions: 111 },
    variants: [
      { name: "Variant", weight: 50, url: `${F}/checkout-v2`, visitors: 4105, conversions: 103 },
    ],
    activity: [
      ["CREATED", "jamie", at(9, 26, 10, 0)],
      ["LAUNCHED", "jamie", at(9, 29, 9, 40)],
      ["RESULT_READY", null, at(10, 12, 15, 0)],
    ],
  },
  {
    key: "e7",
    id: "demo_e7c",
    site: "fernwood",
    type: "AB_TEST",
    name: "Product page CTA copy",
    status: "ACTIVE",
    controlUrl: `${F}/products/trailhead-pack`,
    goalUrl: `${F}/cart`,
    include: 50,
    createdBy: "priya",
    createdAt: at(10, 1, 10, 0),
    publishedAt: at(10, 3, 15, 30),
    updatedAt: at(10, 3, 15, 30),
    designDays: 10,
    control: { weight: 34, visitors: 1891, conversions: 79 },
    variants: [
      {
        name: "Variant A",
        weight: 33,
        visitors: 1890,
        conversions: 86,
        changes: [
          change(
            "c1",
            "button",
            "",
            "#add-to-cart",
            { text: "Add to cart" },
            { text: "Add to pack" },
          ),
        ],
      },
      {
        name: "Variant B",
        weight: 33,
        visitors: 1891,
        conversions: 85,
        changes: [
          change(
            "c1",
            "button",
            "",
            "#add-to-cart",
            { text: "Add to cart" },
            { text: "Add to cart — ships free" },
          ),
        ],
      },
    ],
    activity: [
      ["CREATED", "priya", at(10, 1, 10, 0)],
      ["LAUNCHED", "priya", at(10, 3, 15, 30)],
    ],
  },
  {
    key: "e8",
    id: "demo_e8c",
    site: "fernwood",
    type: "AB_TEST",
    name: "Newsletter popup timing",
    status: "ACTIVE",
    controlUrl: `${F}/`,
    goalUrl: `${F}/pages/newsletter-thanks`,
    include: 30,
    createdBy: "marcus",
    createdAt: at(10, 6, 14, 0),
    publishedAt: at(10, 8, 10, 15),
    updatedAt: at(10, 8, 10, 15),
    designDays: 5,
    control: { weight: 50, visitors: 1160, conversions: 70 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 1158,
        conversions: 74,
        changes: [
          change(
            "c1",
            "heading",
            "Popup heading",
            "#newsletter-popup h2",
            { text: "Join the Fernwood newsletter" },
            { text: "Get 10% off your first order" },
          ),
        ],
      },
    ],
    activity: [
      ["CREATED", "marcus", at(10, 6, 14, 0)],
      ["LAUNCHED", "marcus", at(10, 8, 10, 15)],
    ],
  },
  {
    key: "e9",
    id: "demo_e9c",
    site: "fernwood",
    type: "SPLIT_URL",
    name: "Search results layout",
    status: "ACTIVE",
    controlUrl: `${F}/search`,
    goalUrl: `${F}/cart`,
    include: 25,
    createdBy: "jamie",
    createdAt: at(10, 10, 9, 15),
    // The design lists it as updated Oct 10, 11:02 AM and on day 3: one launch satisfies both.
    publishedAt: at(10, 10, 11, 2),
    updatedAt: at(10, 10, 11, 2),
    designDays: 3,
    control: { weight: 50, visitors: 553, conversions: 16 },
    variants: [
      { name: "Variant", weight: 50, url: `${F}/search-v2`, visitors: 551, conversions: 17 },
    ],
    activity: [
      ["CREATED", "jamie", at(10, 10, 9, 15)],
      ["LAUNCHED", "jamie", at(10, 10, 11, 2)],
    ],
  },
  // Completed experiments launch at the clock time they ended, so their inclusive day count
  // ("Ran … (30 days)") cannot change with the time of day the seed runs.
  {
    key: "e10",
    id: "demo_e10",
    site: "fernwood",
    type: "SPLIT_URL",
    name: "Summer clearance landing page",
    status: "COMPLETED",
    controlUrl: `${F}/summer`,
    goalUrl: `${F}/checkout`,
    include: 100,
    createdBy: "alex",
    createdAt: at(8, 18, 10, 0),
    publishedAt: at(8, 20, 17, 45),
    endedAt: at(9, 18, 17, 45),
    updatedAt: at(9, 18, 17, 45),
    resultReadyAt: at(9, 4, 12, 0),
    designDays: 30,
    share: true,
    control: { weight: 50, visitors: 10650, conversions: 298 },
    variants: [
      { name: "Variant", weight: 50, url: `${F}/summer-v2`, visitors: 10656, conversions: 362 },
    ],
    activity: [
      ["CREATED", "alex", at(8, 18, 10, 0)],
      ["LAUNCHED", "alex", at(8, 20, 17, 45)],
      ["ENDED", "alex", at(9, 18, 17, 45)],
    ],
  },
  {
    key: "e11",
    id: "demo_e11",
    site: "fernwood",
    type: "AB_TEST",
    name: "Mobile navigation menu",
    status: "COMPLETED",
    controlUrl: `${F}/`,
    controlMatch: "PREFIX", // "All pages on fernwoodsupply.com"
    goalUrl: `${F}/checkout`,
    include: 50,
    devices: ["MOBILE"],
    createdBy: "priya",
    createdAt: at(8, 31, 10, 0),
    publishedAt: at(9, 2, 18, 0),
    endedAt: at(9, 30, 18, 0),
    updatedAt: at(9, 30, 18, 0),
    resultReadyAt: at(9, 16, 12, 0),
    designDays: 29,
    control: { weight: 50, visitors: 7951, conversions: 226 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 7951,
        conversions: 235,
        // The design describes this change in prose ("grouped by activity"); the visual editor
        // only edits text, colours and images, so the prose is stored as the text it sets.
        changes: [
          change(
            "c1",
            "text",
            "Mobile menu",
            "#mobile-menu .menu-intro",
            { text: "Shop by category" },
            { text: "grouped by activity" },
          ),
        ],
      },
    ],
    activity: [
      ["CREATED", "priya", at(8, 31, 10, 0)],
      ["LAUNCHED", "priya", at(9, 2, 18, 0)],
      ["ENDED", "priya", at(9, 30, 18, 0)],
    ],
  },
  {
    key: "e12",
    id: "demo_e12",
    site: "fernwood",
    type: "AB_TEST",
    name: "Cart upsell placement",
    status: "COMPLETED",
    controlUrl: `${F}/cart`,
    goalUrl: `${F}/checkout`,
    include: 50,
    createdBy: "jamie",
    createdAt: at(8, 18, 10, 0),
    publishedAt: at(8, 20, 11, 20),
    endedAt: at(9, 12, 11, 20),
    updatedAt: at(9, 12, 11, 20),
    resultReadyAt: at(9, 2, 12, 0),
    designDays: 24,
    control: { weight: 50, visitors: 4935, conversions: 225 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 4935,
        conversions: 278,
        changes: [
          change(
            "c1",
            "text",
            "Upsell",
            "#cart-upsell p",
            { text: "You might also like" },
            { text: "moved above the checkout button" },
          ),
        ],
      },
    ],
    activity: [
      ["CREATED", "jamie", at(8, 18, 10, 0)],
      ["LAUNCHED", "jamie", at(8, 20, 11, 20)],
      ["ENDED", "jamie", at(9, 12, 11, 20)],
    ],
  },
  {
    key: "e13",
    id: "demo_e13",
    site: "fernwood",
    type: "AB_TEST",
    name: "Footer signup form",
    status: "COMPLETED",
    controlUrl: `${F}/`,
    controlMatch: "PREFIX",
    goalUrl: `${F}/pages/newsletter-thanks`,
    include: 50,
    createdBy: "marcus",
    createdAt: at(7, 30, 10, 0),
    publishedAt: at(8, 1, 16, 0),
    endedAt: at(8, 29, 16, 0),
    updatedAt: at(8, 29, 16, 0),
    designDays: 29,
    control: { weight: 50, visitors: 3105, conversions: 68 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 3105,
        conversions: 44,
        changes: [
          change(
            "c1",
            "text",
            "Footer form",
            "#footer-signup p",
            { text: "Get trail notes by email" },
            { text: "name and email fields" },
          ),
        ],
      },
    ],
    activity: [
      ["CREATED", "marcus", at(7, 30, 10, 0)],
      ["LAUNCHED", "marcus", at(8, 1, 16, 0)],
      ["ENDED", "marcus", at(8, 29, 16, 0)],
    ],
  },
  {
    key: "e14",
    id: "demo_e14",
    site: "fernwood",
    type: "SPLIT_URL",
    name: "About page redesign",
    status: "COMPLETED",
    controlUrl: `${F}/about`,
    goalUrl: `${F}/pages/contact`,
    include: 100,
    createdBy: "alex",
    createdAt: at(7, 17, 10, 0),
    publishedAt: at(7, 20, 10, 30),
    endedAt: at(8, 15, 10, 30),
    updatedAt: at(8, 15, 10, 30),
    designDays: 27,
    control: { weight: 50, visitors: 2228, conversions: 52 },
    variants: [
      { name: "Variant", weight: 50, url: `${F}/about-new`, visitors: 2227, conversions: 55 },
    ],
    activity: [
      ["CREATED", "alex", at(7, 17, 10, 0)],
      ["LAUNCHED", "alex", at(7, 20, 10, 30)],
      ["ENDED", "alex", at(8, 15, 10, 30)],
    ],
  },
  {
    key: "n1",
    id: "demo_n1f",
    site: "journal",
    type: "AB_TEST",
    name: "Article newsletter CTA",
    status: "ACTIVE",
    controlUrl: `${J}/articles/trail-running-basics`,
    goalUrl: `${J}/newsletter/thanks`,
    include: 50,
    createdBy: "jamie",
    createdAt: at(10, 12, 14, 0),
    publishedAt: at(10, 13, 8, 5),
    updatedAt: at(10, 13, 8, 5),
    control: { weight: 50, visitors: 0, conversions: 0 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 0,
        conversions: 0,
        changes: [
          change(
            "c1",
            "button",
            "",
            ".newsletter-cta button",
            { text: "Subscribe" },
            { text: "Get the weekly trail notes" },
          ),
        ],
      },
    ],
    activity: [
      ["CREATED", "jamie", at(10, 12, 14, 0)],
      ["LAUNCHED", "jamie", at(10, 13, 8, 5)],
    ],
  },
  {
    key: "n2",
    id: "demo_n2f",
    site: "journal",
    type: "SPLIT_URL",
    name: "New homepage layout",
    status: "ACTIVE",
    controlUrl: `${J}/`,
    goalUrl: `${J}/newsletter/thanks`,
    include: 100,
    createdBy: "jamie",
    createdAt: at(10, 12, 14, 30),
    publishedAt: at(10, 13, 7, 50),
    updatedAt: at(10, 13, 7, 50),
    control: { weight: 50, visitors: 0, conversions: 0 },
    variants: [{ name: "Variant", weight: 50, url: `${J}/home-v2`, visitors: 0, conversions: 0 }],
    activity: [
      ["CREATED", "jamie", at(10, 12, 14, 30)],
      ["LAUNCHED", "jamie", at(10, 13, 7, 50)],
    ],
  },
  {
    key: "n3",
    id: "demo_n3f",
    site: "journal",
    type: "AB_TEST",
    name: "Author bio placement",
    status: "DRAFT",
    controlUrl: `${J}/articles/gear-care-101`,
    goalUrl: `${J}/newsletter/thanks`,
    include: 50,
    devices: ["DESKTOP", "TABLET"],
    wizardStep: 5,
    createdBy: "jamie",
    createdAt: at(10, 12, 15, 0),
    updatedAt: at(10, 12, 17, 30),
    control: { weight: 50, visitors: 0, conversions: 0 },
    variants: [
      {
        name: "Variant A",
        weight: 50,
        visitors: 0,
        conversions: 0,
        changes: [
          change(
            "c1",
            "text",
            "Intro text",
            ".article-intro p",
            { text: "By Jamie Lee" },
            { text: "By Jamie Lee — trail guide and gear tester for 12 years" },
          ),
        ],
      },
    ],
    activity: [["CREATED", "jamie", at(10, 12, 15, 0)]],
  },
];

// ---------------------------------------------------------------------------------------------
// Traffic generation
// ---------------------------------------------------------------------------------------------

interface Assigned {
  id: string;
  visitorId: string;
  anonymousId: string;
  variantId: string | null;
  at: number;
  /** URL the visitor landed on (normalised). */
  page: string;
  convertedAt: number | null;
}

/**
 * The design's cumulative-rate wander for one arm: `rate × (1 ± 0.4/√d)`, ending on the rate.
 * Same seed formula as its chart, so the real chart follows the design's lines.
 */
function designRates(rate: number, armIndex: number, days: number): number[] {
  let seed = 97 + armIndex * 53 + days * 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const out: number[] = [];
  for (let d = 1; d <= days; d++) {
    out.push(rate * (1 + (d === days ? 0 : ((rnd() - 0.5) * 0.8) / Math.sqrt(d))));
  }
  return out;
}

function interpolate(series: readonly number[], position: number): number {
  const i = Math.floor(position);
  if (i >= series.length - 1) return series[series.length - 1]!;
  const f = position - i;
  return series[i]! * (1 - f) + series[i + 1]! * f;
}

/**
 * Assignments and conversions for every arm of one experiment, spread over its run (launch to
 * pause, end or now) so the cumulative chart follows the design's shape and ends exactly on the
 * design's counts.
 */
function generateTraffic(spec: ExperimentSpec, variantIds: string[]): Assigned[] {
  if (!spec.publishedAt) return [];
  const start = spec.publishedAt.getTime();
  const stop = (spec.pausedAt ?? spec.endedAt)?.getTime() ?? NOW;
  const rand = prng(spec.key);

  // UTC days of the run, each with the part of it the run covers.
  const days: { s: number; e: number }[] = [];
  for (let d = Math.floor(start / DAY) * DAY; d < stop; d += DAY) {
    const s = Math.max(d, start);
    const e = Math.min(d + DAY, stop);
    if (e > s) days.push({ s, e });
  }
  // A part day counts as at least half a day, so the first point of the chart is not decided
  // by a handful of visitors.
  const weights = days.map(({ s, e }) => {
    const dow = new Date(s).getUTCDay();
    const share = Math.max(0.5, (e - s) / DAY);
    return share * (dow === 0 || dow === 6 ? 0.8 : 1) * (0.88 + rand() * 0.24);
  });

  const site = SITES[spec.site];
  const arms = [
    { ...spec.control, url: spec.controlUrl, variantId: null as string | null },
    ...spec.variants.map((v, i) => ({
      ...v,
      url: v.url ?? spec.controlUrl,
      variantId: variantIds[i]!,
    })),
  ];
  const all: Assigned[] = [];

  arms.forEach((arm, armIndex) => {
    if (arm.visitors === 0) return;
    const perDay = apportion(arm.visitors, weights);
    const page = urlKey(spec.type === "SPLIT_URL" ? arm.url : spec.controlUrl);
    const assigned: Assigned[][] = [];
    let serial = 0;

    perDay.forEach((n, j) => {
      const { s, e } = days[j]!;
      const list: Assigned[] = [];
      for (let g = 0; g < n; g++) {
        const suffix = `${spec.key}_${armIndex}_${serial++}`;
        list.push({
          id: `demo_a_${suffix}`,
          visitorId: `demo_v_${suffix}`,
          anonymousId: `demo-${site.id}-${suffix}`,
          variantId: arm.variantId,
          at: Math.floor(s + ((e - s) * (g + 0.05 + rand() * 0.9)) / n),
          page,
          convertedAt: null,
        });
      }
      assigned.push(list);
    });

    // Cumulative conversions per day, following the design's wander. The real run spans the
    // design's day count or one more UTC day (launch and now fall at different times of day):
    // then day N of the design is day N here, and the extra day holds the final rate.
    const rate = arm.conversions / arm.visitors;
    const design = designRates(rate, armIndex, spec.designDays ?? days.length);
    const D = design.length;
    const K = days.length;
    const position = (j: number) =>
      K <= D + 1 ? Math.min(j, D - 1) : K > 1 ? (j * (D - 1)) / (K - 1) : 0;
    const cumulative: number[] = [];
    let visitorsSoFar = 0;
    for (let j = 0; j < K; j++) {
      visitorsSoFar += perDay[j]!;
      const r = interpolate(design, position(j));
      cumulative.push(Math.min(visitorsSoFar, Math.max(0, Math.round(r * visitorsSoFar))));
    }
    cumulative[K - 1] = arm.conversions;
    for (let j = K - 2; j >= 0; j--) cumulative[j] = Math.min(cumulative[j]!, cumulative[j + 1]!);

    const open: Assigned[] = []; // unconverted, assigned on earlier days
    for (let j = 0; j < K; j++) {
      const { s, e } = days[j]!;
      let need = cumulative[j]! - (j > 0 ? cumulative[j - 1]! : 0);
      const today = assigned[j]!.filter((a) => a.at < e - MINUTE);
      // Same-day conversions first, picked at random; then the most recent earlier visitors.
      for (let i = today.length - 1; i > 0; i--) {
        const k = Math.floor(rand() * (i + 1));
        [today[i], today[k]] = [today[k]!, today[i]!];
      }
      for (const a of today) {
        if (need === 0) break;
        a.convertedAt = Math.min(
          e - 1,
          a.at + Math.floor(MINUTE + rand() * Math.min(89 * MINUTE, (e - a.at) * 0.9)),
        );
        need--;
      }
      while (need > 0 && open.length > 0) {
        const a = open.pop()!;
        a.convertedAt = Math.floor(s + rand() * (e - s));
        need--;
      }
      for (const a of assigned[j]!) if (a.convertedAt === null) open.push(a);
    }

    const converted = assigned.flat().filter((a) => a.convertedAt !== null).length;
    if (converted !== arm.conversions) {
      throw new Error(
        `${spec.key} arm ${armIndex}: ${converted} conversions, expected ${arm.conversions}`,
      );
    }
    for (const list of assigned) all.push(...list);
  });

  return all;
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

const CHUNK = 10_000;

/** Bulk insert through `jsonb_to_recordset`: one statement per chunk, any row count. */
async function insertRows(
  tx: Tx,
  table: string,
  columns: readonly (readonly [name: string, type: string])[],
  rows: readonly object[],
) {
  const names = columns.map(([n]) => `"${n}"`).join(", ");
  const defs = columns.map(([n, t]) => `"${n}" ${t}`).join(", ");
  const sql = `INSERT INTO "${table}" (${names}) SELECT ${names} FROM jsonb_to_recordset($1::jsonb) AS r(${defs})`;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.$executeRawUnsafe(sql, JSON.stringify(rows.slice(i, i + CHUNK)));
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

async function seedPeople(tx: Tx): Promise<Record<UserKey, string>> {
  await tx.workspace.upsert({
    where: { id: WORKSPACE_ID },
    create: { id: WORKSPACE_ID, name: WORKSPACE_NAME, createdAt: onDate(2025, 3, 1) },
    update: { name: WORKSPACE_NAME },
  });

  const ids = {} as Record<UserKey, string>;
  for (const [key, spec] of Object.entries(USERS) as [UserKey, UserSpec][]) {
    // By id or by address: the address may have been changed in Settings while exploring.
    const existing = await tx.user.findFirst({
      where: { OR: [{ id: spec.id }, { email: spec.email }] },
      orderBy: { createdAt: "asc" },
      select: { id: true, passwordHash: true },
    });
    const keepHash = await passwordMatches(DEMO_PASSWORD, existing?.passwordHash ?? null);
    const passwordHash = keepHash ? existing!.passwordHash! : await hashPassword(DEMO_PASSWORD);
    const fields = {
      name: spec.name,
      email: spec.email,
      emailVerified: spec.joined,
      image: null,
      passwordHash,
      passwordChangedAt: key === "alex" ? ALEX_PASSWORD_CHANGED : spec.joined,
      currentWorkspaceId: WORKSPACE_ID,
      disabledAt: null,
      createdAt: spec.joined,
    };
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: fields, select: { id: true } })
      : await tx.user.create({ data: { id: spec.id, ...fields }, select: { id: true } });
    ids[key] = user.id;
  }

  // Exactly one owner: hand ownership back to Alex if it was transferred while exploring.
  await tx.membership.updateMany({
    where: { workspaceId: WORKSPACE_ID, role: "OWNER", userId: { not: ids.alex } },
    data: { role: "ADMIN" },
  });
  for (const [key, spec] of Object.entries(USERS) as [UserKey, UserSpec][]) {
    const fields = { role: spec.role, lastActiveAt: spec.lastActive, createdAt: spec.joined };
    await tx.membership.upsert({
      where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: ids[key] } },
      create: { workspaceId: WORKSPACE_ID, userId: ids[key], ...fields },
      update: fields,
    });
  }
  // The design's defaults are the app's defaults: no stored preference rows.
  await tx.notificationPreference.deleteMany({ where: { userId: { in: Object.values(ids) } } });

  // One pending invite. A second pending invite to the same address would break the
  // `workspace_invites_pending` index, so any other one is cleared first.
  await tx.workspaceInvite.deleteMany({
    where: {
      workspaceId: WORKSPACE_ID,
      email: INVITE.email,
      id: { not: INVITE.id },
      acceptedAt: null,
      revokedAt: null,
    },
  });
  const inviteFields = {
    role: INVITE.role,
    invitedById: ids.alex,
    sentAt: INVITE.sentAt,
    expiresAt: new Date(INVITE.sentAt.getTime() + 7 * DAY),
    acceptedAt: null,
    acceptedById: null,
    revokedAt: null,
    createdAt: INVITE.sentAt,
  };
  await tx.workspaceInvite.upsert({
    where: { id: INVITE.id },
    create: {
      id: INVITE.id,
      workspaceId: WORKSPACE_ID,
      email: INVITE.email,
      // Only the hash is ever stored; the raw token is discarded, so this link cannot be opened.
      tokenHash: createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex"),
      ...inviteFields,
    },
    update: inviteFields,
  });

  for (const s of SESSIONS) {
    const fields = {
      userId: ids.alex,
      expires: new Date(NOW + 30 * DAY),
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      userAgent: s.userAgent,
      city: s.city,
      country: s.country,
    };
    await tx.session.upsert({
      where: { id: s.id },
      // A random token nobody is told: the row is listed, but cannot be used to sign in.
      create: { id: s.id, sessionToken: randomBytes(32).toString("hex"), ...fields },
      update: fields,
    });
  }

  return ids;
}

async function seedSites(tx: Tx, users: Record<UserKey, string>) {
  for (const site of Object.values(SITES)) {
    const fields = {
      workspaceId: WORKSPACE_ID,
      createdById: users[site.createdBy],
      name: site.name,
      domain: site.domain,
      protocol: "HTTPS" as const,
      publicSiteId: site.publicSiteId,
      pixelVerifiedAt: site.pixelVerifiedAt,
      colorIndex: site.colorIndex,
      lastSeenAt: site.lastSeenAt,
      trackingAlertSentAt: site.trackingAlertSentAt,
      createdAt: site.createdAt,
    };
    await tx.website.upsert({
      where: { id: site.id },
      create: { id: site.id, ...fields },
      update: fields,
    });
  }

  const siteIds = Object.values(SITES).map((s) => s.id);
  await tx.$executeRawUnsafe(
    `DELETE FROM "website_visitor_days" WHERE "websiteId" = ANY($1::text[]) AND starts_with("anonymousId", 'demo-')`,
    siteIds,
  );
  await tx.$executeRawUnsafe(
    `DELETE FROM "page_visitor_days" WHERE "websiteId" = ANY($1::text[]) AND starts_with("anonymousId", 'demo-')`,
    siteIds,
  );

  const today = Math.floor(NOW / DAY) * DAY;
  for (const site of Object.values(SITES)) {
    if (site.series) {
      // One distinct browser per row, so distinct visitors over any window = the sum of its days.
      await tx.$executeRawUnsafe(
        `INSERT INTO "website_visitor_days" ("websiteId", "day", "anonymousId")
         SELECT $1, $2::date + (c.i - 1)::int,
                'demo-' || $1 || '-' || to_char($2::date + (c.i - 1)::int, 'YYYYMMDD') || '-' || g
         FROM jsonb_array_elements_text($3::jsonb) WITH ORDINALITY AS c(n, i)
         CROSS JOIN LATERAL generate_series(1, c.n::int) AS g`,
        site.id,
        utcDayKey(today - (site.series.length - 1) * DAY),
        JSON.stringify(site.series),
      );
    }
    for (const page of site.pages) {
      // `pageBaseline` = visitor-days on the page over the last 30 days ÷ 30.
      await tx.$executeRawUnsafe(
        `INSERT INTO "page_visitor_days" ("websiteId", "urlKey", "day", "anonymousId")
         SELECT $1, $2, $3::date + d, 'demo-' || $1 || '-p-' || md5($2) || '-' || d || '-' || g
         FROM generate_series(0, 29) AS d CROSS JOIN LATERAL generate_series(1, $4::int) AS g`,
        site.id,
        urlKey(page.url),
        utcDayKey(today - 29 * DAY),
        page.perDay,
      );
    }
  }
}

async function seedExperiments(tx: Tx, users: Record<UserKey, string>) {
  const siteIds = Object.values(SITES).map((s) => s.id);
  const experimentIds = EXPERIMENTS.map((e) => e.id);
  const variantIdsOf = (spec: ExperimentSpec) =>
    spec.variants.map((_, i) => `${spec.id}_v${i + 1}`);

  // Generated traffic is rewritten every run: it moves with the clock.
  await tx.assignment.deleteMany({ where: { experimentId: { in: experimentIds } } });
  await tx.$executeRawUnsafe(
    `DELETE FROM "visitors" WHERE "websiteId" = ANY($1::text[]) AND starts_with("id", 'demo_v_')`,
    siteIds,
  );
  // Demo experiments the seed no longer defines.
  await tx.experiment.deleteMany({
    where: { websiteId: { in: siteIds }, id: { startsWith: "demo_", notIn: experimentIds } },
  });
  await tx.experimentActivity.deleteMany({ where: { experimentId: { in: experimentIds } } });

  const shareLinks: { name: string; token: string }[] = [];

  for (const spec of EXPERIMENTS) {
    const existing = await tx.experiment.findUnique({
      where: { id: spec.id },
      select: { shareToken: true, sharedAt: true },
    });
    const shareToken = spec.share
      ? (existing?.shareToken ?? randomBytes(24).toString("base64url"))
      : null;
    if (shareToken) shareLinks.push({ name: spec.name, token: shareToken });

    const fields = {
      websiteId: SITES[spec.site].id,
      type: spec.type,
      name: spec.name,
      description: null,
      controlUrl: spec.controlUrl,
      controlMatchType: spec.controlMatch ?? ("EXACT" as const),
      conversionName: null,
      conversionUrl: spec.goalUrl,
      conversionMatchType: "EXACT" as const,
      controlWeight: spec.control.weight,
      status: spec.status,
      trafficAllocation: spec.include,
      primaryMetric: "CONVERSION_RATE" as const,
      targetDevices: spec.devices ?? [],
      keepQueryParams: true,
      wizardStep: spec.wizardStep ?? 5,
      createdById: users[spec.createdBy],
      shareToken,
      sharedAt: shareToken ? (existing?.sharedAt ?? spec.publishedAt ?? null) : null,
      publishedAt: spec.publishedAt ?? null,
      pausedAt: spec.pausedAt ?? null,
      endedAt: spec.endedAt ?? null,
      resultReadyAt: spec.resultReadyAt ?? null,
      createdAt: spec.createdAt,
      updatedAt: spec.updatedAt,
    };
    await tx.experiment.upsert({
      where: { id: spec.id },
      create: { id: spec.id, ...fields },
      update: fields,
    });

    const variantIds = variantIdsOf(spec);
    await tx.experimentVariant.deleteMany({
      where: { experimentId: spec.id, id: { notIn: variantIds } },
    });
    for (const [i, v] of spec.variants.entries()) {
      const vf = {
        experimentId: spec.id,
        position: i + 1,
        name: v.name,
        colorIndex: i + 1,
        url: spec.type === "SPLIT_URL" ? (v.url ?? null) : null,
        changes: v.changes ? { schemaVersion: 1, changes: v.changes } : Prisma.DbNull,
        weight: v.weight,
      };
      await tx.experimentVariant.upsert({
        where: { id: variantIds[i]! },
        create: { id: variantIds[i]!, ...vf },
        update: vf,
      });
    }

    await tx.experimentActivity.createMany({
      data: spec.activity.map(([type, actor, when], n) => ({
        id: `${spec.id}_act${n + 1}`,
        experimentId: spec.id,
        type,
        actorId: actor ? users[actor] : null,
        createdAt: when,
      })),
    });
  }

  // Traffic.
  const visitors: object[] = [];
  const assignments: object[] = [];
  const events: object[] = [];
  const conversions: object[] = [];
  for (const spec of EXPERIMENTS) {
    const websiteId = SITES[spec.site].id;
    const goal = spec.goalUrl ? urlKey(spec.goalUrl) : null;
    for (const a of generateTraffic(spec, variantIdsOf(spec))) {
      const suffix = a.id.slice("demo_a_".length);
      const last = a.convertedAt ?? a.at;
      visitors.push({
        id: a.visitorId,
        websiteId,
        anonymousId: a.anonymousId,
        firstSeenAt: iso(a.at),
        lastSeenAt: iso(last),
        createdAt: iso(a.at),
      });
      assignments.push({
        id: a.id,
        experimentId: spec.id,
        visitorId: a.visitorId,
        variantId: a.variantId,
        assignedAt: iso(a.at),
        createdAt: iso(a.at),
      });
      const event = {
        websiteId,
        experimentId: spec.id,
        visitorId: a.visitorId,
        assignmentId: a.id,
        variantId: a.variantId,
      };
      events.push({
        id: `demo_pv_${suffix}`,
        ...event,
        type: "page_view",
        url: a.page,
        occurredAt: iso(a.at),
        createdAt: iso(a.at),
      });
      if (a.convertedAt !== null && goal) {
        conversions.push({
          id: `demo_c_${suffix}`,
          experimentId: spec.id,
          visitorId: a.visitorId,
          assignmentId: a.id,
          variantId: a.variantId,
          url: goal,
          occurredAt: iso(a.convertedAt),
          createdAt: iso(a.convertedAt),
        });
        events.push({
          id: `demo_cv_${suffix}`,
          ...event,
          type: "conversion",
          url: goal,
          occurredAt: iso(a.convertedAt),
          createdAt: iso(a.convertedAt),
        });
      }
    }
  }

  const ts = "timestamp(3)";
  await insertRows(
    tx,
    "visitors",
    [
      ["id", "text"],
      ["websiteId", "text"],
      ["anonymousId", "text"],
      ["firstSeenAt", ts],
      ["lastSeenAt", ts],
      ["createdAt", ts],
    ],
    visitors,
  );
  await insertRows(
    tx,
    "assignments",
    [
      ["id", "text"],
      ["experimentId", "text"],
      ["visitorId", "text"],
      ["variantId", "text"],
      ["assignedAt", ts],
      ["createdAt", ts],
    ],
    assignments,
  );
  await insertRows(
    tx,
    "events",
    [
      ["id", "text"],
      ["websiteId", "text"],
      ["experimentId", "text"],
      ["visitorId", "text"],
      ["assignmentId", "text"],
      ["variantId", "text"],
      ["type", '"EventType"'],
      ["url", "text"],
      ["occurredAt", ts],
      ["createdAt", ts],
    ],
    events,
  );
  await insertRows(
    tx,
    "conversions",
    [
      ["id", "text"],
      ["experimentId", "text"],
      ["visitorId", "text"],
      ["assignmentId", "text"],
      ["variantId", "text"],
      ["url", "text"],
      ["occurredAt", ts],
      ["createdAt", ts],
    ],
    conversions,
  );

  // Every URL an experiment needs has passed its install check minutes ago — the Review tab's
  // "loaded normally on the last check", and what lets a demo draft launch without fetching.
  const checks = new Map<string, { websiteId: string; key: string }>();
  for (const spec of EXPERIMENTS) {
    const websiteId = SITES[spec.site].id;
    const urls = [spec.controlUrl, ...spec.variants.map((v) => v.url), spec.goalUrl];
    for (const url of urls) {
      if (!url) continue;
      const key = urlKey(url);
      checks.set(`${websiteId}|${key}`, { websiteId, key });
    }
  }
  for (const { websiteId, key } of checks.values()) {
    const id = `demo_tc_${createHash("sha256").update(`${websiteId}|${key}`).digest("hex").slice(0, 20)}`;
    await tx.$executeRawUnsafe(
      `INSERT INTO "tracking_checks" ("id", "websiteId", "urlKey", "result", "method", "pageLoaded", "httpStatus", "detail", "checkedAt")
       VALUES ($1, $2, $3, 'OK', 'html', true, 200, NULL, $4::timestamp(3))
       ON CONFLICT ("websiteId", "urlKey") DO UPDATE SET "result" = 'OK', "method" = 'html',
         "pageLoaded" = true, "httpStatus" = 200, "detail" = NULL, "checkedAt" = EXCLUDED."checkedAt"`,
      id,
      websiteId,
      key,
      iso(NOW - 10 * MINUTE),
    );
  }

  // Last, so nothing above moves it: `updatedAt` drives the list's "Last updated" and order.
  for (const spec of EXPERIMENTS) {
    await tx.$executeRawUnsafe(
      `UPDATE "experiments" SET "updatedAt" = $2::timestamp(3) WHERE "id" = $1`,
      spec.id,
      spec.updatedAt.toISOString(),
    );
  }

  return shareLinks;
}

async function counts() {
  const siteIds = Object.values(SITES).map((s) => s.id);
  const experimentIds = EXPERIMENTS.map((e) => e.id);
  const emails = Object.values(USERS).map((u) => u.email);
  const one = async (sql: string, ...params: unknown[]) => {
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(sql, ...params);
    return Number(rows[0]!.n);
  };
  return {
    users: await one(`SELECT count(*) n FROM users WHERE email = ANY($1::text[])`, emails),
    memberships: await one(
      `SELECT count(*) n FROM memberships WHERE "workspaceId" = $1`,
      WORKSPACE_ID,
    ),
    invites: await one(
      `SELECT count(*) n FROM workspace_invites WHERE "workspaceId" = $1`,
      WORKSPACE_ID,
    ),
    seededSessions: await one(
      `SELECT count(*) n FROM sessions WHERE starts_with(id, 'demo_sess_')`,
    ),
    websites: await one(`SELECT count(*) n FROM websites WHERE id = ANY($1::text[])`, siteIds),
    experiments: await one(
      `SELECT count(*) n FROM experiments WHERE id = ANY($1::text[])`,
      experimentIds,
    ),
    variants: await one(
      `SELECT count(*) n FROM experiment_variants WHERE "experimentId" = ANY($1::text[])`,
      experimentIds,
    ),
    activities: await one(
      `SELECT count(*) n FROM experiment_activities WHERE "experimentId" = ANY($1::text[])`,
      experimentIds,
    ),
    visitors: await one(
      `SELECT count(*) n FROM visitors WHERE "websiteId" = ANY($1::text[])`,
      siteIds,
    ),
    assignments: await one(
      `SELECT count(*) n FROM assignments WHERE "experimentId" = ANY($1::text[])`,
      experimentIds,
    ),
    events: await one(
      `SELECT count(*) n FROM events WHERE "experimentId" = ANY($1::text[])`,
      experimentIds,
    ),
    conversions: await one(
      `SELECT count(*) n FROM conversions WHERE "experimentId" = ANY($1::text[])`,
      experimentIds,
    ),
    websiteVisitorDays: await one(
      `SELECT count(*) n FROM website_visitor_days WHERE "websiteId" = ANY($1::text[])`,
      siteIds,
    ),
    pageVisitorDays: await one(
      `SELECT count(*) n FROM page_visitor_days WHERE "websiteId" = ANY($1::text[])`,
      siteIds,
    ),
    trackingChecks: await one(
      `SELECT count(*) n FROM tracking_checks WHERE "websiteId" = ANY($1::text[])`,
      siteIds,
    ),
  };
}

async function main() {
  const started = Date.now();
  const shareLinks = await db.$transaction(
    async (tx) => {
      const users = await seedPeople(tx);
      await seedSites(tx, users);
      return seedExperiments(tx, users);
    },
    { maxWait: 30_000, timeout: 10 * 60_000 },
  );

  const appUrl = (process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000").replace(/\/$/, "");
  const roles = (Object.values(USERS) as UserSpec[]).map(
    (u) => `    ${u.email.padEnd(30)} ${u.role.charAt(0) + u.role.slice(1).toLowerCase()}`,
  );
  console.log(
    [
      `Seeded the “${WORKSPACE_NAME}” demo workspace in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
      "",
      `  Sign in at ${appUrl}/login with password “${DEMO_PASSWORD}” as any of:`,
      ...roles,
      "",
      "  Public results links:",
      ...shareLinks.map((l) => `    ${l.name}: ${appUrl}/share/${l.token}`),
      "",
      "  Demo rows:",
      ...Object.entries(await counts()).map(
        ([k, v]) => `    ${k.padEnd(20)} ${v.toLocaleString("en-US")}`,
      ),
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

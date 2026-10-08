/**
 * Domain vocabulary shared by every layer — the client UI, the pure logic in `lib/`, the
 * server services and the API that feeds the SDK.
 *
 * Client-safe: types and constants only, no imports from `server/` or Prisma. The database
 * enums (`ExperimentType`, `ExperimentStatus`, …) are mapped onto these lowercase names at the
 * service boundary so components never depend on the generated client.
 *
 * The UI says "project" where the database says "website": they are the same entity.
 */

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

/** `redirect` = Split URL test (database `SPLIT_URL`); `ab` = element-change test (`AB`). */
export type ExperimentKind = "redirect" | "ab";

/**
 * Display status. `completed` is the database's `ARCHIVED`; `winner` is not stored — it is a
 * completed experiment whose `winnerPosition` is a variant (> 0), see `displayStatus`.
 */
export type ExperimentStatusKey = "draft" | "running" | "paused" | "completed";
export type DisplayStatusKey = ExperimentStatusKey | "winner";

/** Arms are at most Control + four variants. */
export const MAX_ARMS = 5;
export const ARM_NAMES = ["Control", "Variant A", "Variant B", "Variant C", "Variant D"] as const;
export const ARM_COLORS = ["#7C879C", "#2B59F0", "#F0603F", "#11A08F", "#B7860B"] as const;
export const ARM_KEYS = ["control", "a", "b", "c", "d"] as const;
export type ArmKey = (typeof ARM_KEYS)[number];

export function armName(position: number): string {
  return ARM_NAMES[position] ?? `Variant ${position}`;
}
export function armColor(position: number): string {
  return ARM_COLORS[position] ?? ARM_COLORS[ARM_COLORS.length - 1]!;
}

/**
 * One element change on an A/B variant.
 *
 * `selector` is a CSS selector on the customer's page and is what the SDK applies. `el` names
 * the visual editor's canvas element the change was made on (eyebrow, headline, …), so the
 * editor can show it; it has no meaning to the SDK.
 */
export type ChangeProp = "text" | "bg" | "image";
export type EditorElement = "eyebrow" | "headline" | "sub" | "cta" | "trust" | "image";
export interface Change {
  selector: string;
  prop: ChangeProp;
  value: string;
  el?: EditorElement;
}

/** An arm as edited in the wizard. Position 0 is control. */
export interface ArmDraft {
  /** Existing `ExperimentVariant.id` for variants being edited; absent for control and new arms. */
  id?: string;
  name: string;
  /** Split URL only (control's comes from the experiment URL). Empty for A/B. */
  url: string;
  /** Percentage of included traffic, 0–100; all arms sum to 100. */
  weight: number;
  /** A/B only. */
  changes: Change[];
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

export type PageMatch = "exact" | "contains" | "starts" | "wildcard" | "regex";
export type Device = "desktop" | "tablet" | "mobile";
export type Audience = "all" | "new" | "returning";
export type ConditionField = "query" | "utm_source" | "utm_medium" | "utm_campaign" | "referrer";
export type ConditionOp = "equals" | "not" | "contains" | "exists";

export interface TargetCondition {
  field: ConditionField;
  /** Parameter name; used when `field` is `query`. */
  key: string;
  op: ConditionOp;
  value: string;
}

/** Stored as `Experiment.targeting` (JSON) and served to the SDK. */
export interface Targeting {
  match: PageMatch;
  pattern: string;
  /** Helper input in the wizard only ("Test a URL"); not used for delivery. */
  testUrl: string;
  audience: Audience;
  devices: Device[];
  geo: "all" | "some";
  geoMode: "include" | "exclude";
  /** ISO 3166-1 alpha-2 codes. */
  countries: string[];
  logic: "all" | "any";
  conditions: TargetCondition[];
}

export const ALL_DEVICES: Device[] = ["desktop", "tablet", "mobile"];

export function defaultTargeting(pattern = ""): Targeting {
  return {
    match: "exact",
    pattern,
    testUrl: pattern,
    audience: "all",
    devices: [...ALL_DEVICES],
    geo: "all",
    geoMode: "include",
    countries: [],
    logic: "all",
    conditions: [],
  };
}

/** Countries offered by the targeting picker (label → ISO code). */
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "AU", name: "Australia" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "JP", name: "Japan" },
  { code: "SG", name: "Singapore" },
];

// ---------------------------------------------------------------------------
// Goals and metrics
// ---------------------------------------------------------------------------

/** `url` = reaching a conversion URL (Split URL default); `event` = a project metric. */
export type GoalMode = "url" | "event";
export type CountingKey = "unique" | "all";
export type MetricKindKey = "event" | "page";

export interface MetricSummary {
  id: string;
  name: string;
  kind: MetricKindKey;
  key: string;
  url: string | null;
  system: boolean;
  /** ISO timestamp of the latest hit, or null when never received. */
  lastReceivedAt: string | null;
  count24h: number;
  /** Experiments using it as primary or secondary goal. */
  usedIn: number;
}

// ---------------------------------------------------------------------------
// The wizard draft
// ---------------------------------------------------------------------------

/** Everything the create/edit wizard holds. Mirrors the prototype's draft object. */
export interface ExperimentDraft {
  /** Set when editing an existing (draft) experiment. */
  id: string | null;
  projectId: string;
  type: ExperimentKind;
  name: string;
  /** Control/entry URL (Split URL) or the page URL (A/B). */
  url: string;
  hypothesis: string;
  arms: ArmDraft[];
  /** Percentage of matching traffic included in the experiment, 1–100. */
  coverage: number;
  targeting: Targeting;
  goalMode: GoalMode;
  /** Metric id when `goalMode` is `event`. */
  goal: string;
  convUrl: string;
  convMatch: "exact" | "starts";
  secondary: string[];
  counting: CountingKey;
}

export const WIZARD_STEPS = [
  ["type", "Type"],
  ["basics", "Setup"],
  ["variants", "Variants"],
  ["traffic", "Traffic"],
  ["targeting", "Targeting"],
  ["goal", "Goals"],
  ["review", "Review & launch"],
] as const;
export type WizardStepKey = (typeof WIZARD_STEPS)[number][0];

/** Field errors keyed by step, then by field — the shape `validate()` returns. */
export type DraftErrors = Partial<Record<WizardStepKey, Record<string, string>>>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type InstallState = "new" | "checking" | "done";
export type InstallMethodKey = "direct" | "gtm";
export type MemberRoleKey = "Owner" | "Editor" | "Viewer";
export type Threshold = 0.9 | 0.95 | 0.99;

// ---------------------------------------------------------------------------
// Loading an experiment into the wizard
// ---------------------------------------------------------------------------

/**
 * What the server returns for an experiment so `draftFromExperiment` (lib/validate-draft.ts)
 * can open it in the wizard. Plain, serialisable data already mapped onto domain keys.
 * `targeting` is the raw stored JSON (or null); it is parsed tolerantly on the client.
 */
export interface ExperimentDraftSource {
  id: string;
  projectId: string;
  type: ExperimentKind;
  name: string;
  /** Control URL (Split URL) or page URL (A/B). */
  url: string;
  hypothesis: string | null;
  /** Position order, control first. Control's `url` is ignored (it is `url` above). */
  arms: {
    id?: string | null;
    name?: string | null;
    url: string | null;
    weight: number;
    changes?: Change[] | null;
  }[];
  coverage: number;
  targeting: unknown;
  goalMetricId: string | null;
  conversionUrl: string | null;
  conversionMatch: "exact" | "starts";
  secondaryMetricIds: string[];
  counting: CountingKey;
}

/**
 * One-line descriptions of an A/B variant's saved visual changes — "Heading: “Built for the
 * trail”", "Hero button: “Shop fall deals”, background #B4532A" — for the experiment's results
 * table, its Review tab (checks and configuration) and anything else that has to say what a
 * variant changes without opening the editor.
 *
 * Reads the stored `ExperimentVariant.changes` JSON as it is: a bare `VisualChange[]` or a
 * `{ schemaVersion, changes }` envelope (spec §4.4). Malformed items are skipped one by one rather
 * than failing the list — a description is display text, and one bad row must not blank the rest.
 *
 * Pure and dependency-free, so client components can use it too.
 */

export type ChangeKind = "heading" | "text" | "button" | "image" | "block";

/** The string values a change can set, in the order a description names them. */
const STRING_KEYS = [
  "text",
  "backgroundColor",
  "src",
  "alt",
  "color",
  "fontSize",
  "fontWeight",
  "textAlign",
  "padding",
  "margin",
] as const;
type StringKey = (typeof STRING_KEYS)[number];

/** The part of a stored change a description needs. */
export interface DescribableChange {
  kind: ChangeKind;
  /** The editor's element label ("Hero heading"); optional. */
  label?: string;
  set: Partial<Record<StringKey, string>> & { hidden?: true };
}

const KINDS: ReadonlySet<string> = new Set(["heading", "text", "button", "image", "block"]);

/** Longest quoted text a description shows before eliding it. */
export const SUMMARY_TEXT_MAX = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The well-formed changes in a stored `changes` value, in stored order. */
export function readStoredChanges(stored: unknown): DescribableChange[] {
  const list = Array.isArray(stored)
    ? stored
    : isRecord(stored) && Array.isArray(stored["changes"])
      ? stored["changes"]
      : [];

  const out: DescribableChange[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item["kind"] !== "string" || !KINDS.has(item["kind"])) continue;
    const set = item["set"];
    if (!isRecord(set)) continue;

    const values: DescribableChange["set"] = {};
    for (const key of STRING_KEYS) {
      const value = set[key];
      if (typeof value === "string") values[key] = value;
    }
    if (set["hidden"] === true) values.hidden = true;
    if (Object.keys(values).length === 0) continue;

    const label = typeof item["label"] === "string" ? item["label"].trim() : "";
    out.push({ kind: item["kind"] as ChangeKind, ...(label ? { label } : {}), set: values });
  }
  return out;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_TEXT_MAX
    ? `${flat.slice(0, SUMMARY_TEXT_MAX - 1).trimEnd()}…`
    : flat;
}

function subject(change: DescribableChange): string {
  if (change.label) return change.label;
  switch (change.kind) {
    case "heading":
      return "Heading";
    case "text":
      return "Text";
    case "button":
      return change.set.text !== undefined ? "Button text" : "Button";
    case "image":
      return "Image";
    case "block":
      return "Block";
  }
}

/** "Heading: “Built for the trail”" — the element, then what changed on it. */
export function describeChange(change: DescribableChange): string {
  const parts: string[] = [];
  if (change.set.text !== undefined) parts.push(`“${clip(change.set.text)}”`);
  if (change.set.backgroundColor !== undefined) {
    parts.push(`background ${change.set.backgroundColor.trim()}`);
  }
  if (change.set.src !== undefined) parts.push("new image");
  if (change.set.alt !== undefined) parts.push(`alt text “${clip(change.set.alt)}”`);
  if (change.set.color !== undefined) parts.push(`text colour ${change.set.color.trim()}`);
  if (change.set.fontSize !== undefined) parts.push(`size ${change.set.fontSize.trim()}`);
  if (change.set.fontWeight !== undefined) parts.push(`weight ${change.set.fontWeight.trim()}`);
  if (change.set.textAlign !== undefined) parts.push(`aligned ${change.set.textAlign.trim()}`);
  if (change.set.padding !== undefined) parts.push(`padding ${change.set.padding.trim()}`);
  if (change.set.margin !== undefined) parts.push(`margin ${change.set.margin.trim()}`);
  if (change.set.hidden) parts.push("hidden");
  return `${subject(change)}: ${parts.join(", ")}`;
}

/** One description per well-formed stored change. */
export function changeSummaries(stored: unknown): string[] {
  return readStoredChanges(stored).map(describeChange);
}

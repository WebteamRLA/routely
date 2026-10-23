import { z } from "zod";

/**
 * A/B test visual changes — what the visual editor saves into `ExperimentVariant.changes`
 * (spec §4.4), stored as `{ schemaVersion: 1, changes: VisualChange[] }`.
 *
 * The browser half of this contract is `packages/sdk/src/contract.ts` (`VisualChange`, which the
 * config endpoint projects to `{selector, kind, fingerprint:{tag}, set}`); the SDK re-validates
 * every value before applying it, and so does this schema before storing it. The two agree on
 * what a safe value is:
 *
 *  - `text` — plain text ≤ 2,000 characters, applied with `textContent`, never as HTML;
 *  - `backgroundColor` — `#rgb`, `#rrggbb`, `rgb(…)` or `rgba(…)`, nothing that could carry
 *    other CSS;
 *  - `src` — an `https:` URL ≤ 2,048 characters (the SDK also accepts `http:`; the editor never
 *    produces one, so storing is stricter);
 *  - `alt` — ≤ 500 characters.
 *
 * `original` is what the element held when the change was authored. It is informational (the
 * review shows it, the SDK never reads it) and comes from someone else's page, so it is capped
 * but not otherwise judged.
 */

export const VISUAL_CHANGE_SCHEMA_VERSION = 1;
export const MAX_CHANGES_PER_VARIANT = 50;

const MAX_TEXT = 2_000;
const MAX_ALT = 500;
const MAX_SRC = 2_048;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

export const elementKindSchema = z.enum(["heading", "text", "button", "image"]);

const colorSchema = z
  .string()
  .trim()
  .refine(
    (value) => HEX.test(value) || RGB.test(value),
    "Use a colour like #1F3D2B or rgb(31, 61, 43).",
  );

const imageUrlSchema = z
  .string()
  .trim()
  .max(MAX_SRC, `Use an image URL of ${MAX_SRC} characters or fewer.`)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an https:// image URL.");

/** The values a change sets. At least one, each valid. */
export const visualChangeSetSchema = z
  .object({
    text: z.string().max(MAX_TEXT, `Use ${MAX_TEXT} characters or fewer.`).optional(),
    backgroundColor: colorSchema.optional(),
    src: imageUrlSchema.optional(),
    alt: z.string().max(MAX_ALT, `Use ${MAX_ALT} characters or fewer.`).optional(),
  })
  .strict();

/** What the element held before — capped, otherwise taken as found. */
const originalSchema = z
  .object({
    text: z.string().max(20_000).optional(),
    backgroundColor: z.string().max(200).optional(),
    src: z
      .string()
      .max(MAX_SRC * 2)
      .optional(),
    alt: z.string().max(5_000).optional(),
  })
  .strict();

const SET_KEYS = ["text", "backgroundColor", "src", "alt"] as const;

export const visualChangeSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    selector: z.string().trim().min(1).max(1_000),
    kind: elementKindSchema,
    label: z.string().max(200),
    fingerprint: z
      .object({
        tag: z
          .string()
          .trim()
          .min(1)
          .max(32)
          .regex(/^[a-z][a-z0-9-]*$/i),
        text: z.string().max(500).optional(),
        src: z
          .string()
          .max(MAX_SRC * 2)
          .optional(),
      })
      .strict(),
    original: originalSchema,
    set: visualChangeSetSchema,
  })
  .strict()
  .superRefine((change, ctx) => {
    const keys = SET_KEYS.filter((key) => change.set[key] !== undefined);
    if (keys.length === 0) {
      ctx.addIssue({ code: "custom", path: ["set"], message: "A change has to set something." });
      return;
    }
    // A value equal to the original is no change at all; the editor drops those itself, so one
    // arriving here means the client is out of step.
    if (keys.every((key) => change.set[key] === change.original[key])) {
      ctx.addIssue({
        code: "custom",
        path: ["set"],
        message: "A change has to differ from the original.",
      });
    }
  });

export type VisualChange = z.infer<typeof visualChangeSchema>;
export type VisualChangeSet = z.infer<typeof visualChangeSetSchema>;

/** One variant's change list: ≤ 50, one per element (ids unique). */
export const visualChangesSchema = z
  .array(visualChangeSchema)
  .max(
    MAX_CHANGES_PER_VARIANT,
    `A variant can have at most ${MAX_CHANGES_PER_VARIANT} changed elements.`,
  )
  .superRefine((changes, ctx) => {
    const seen = new Set<string>();
    changes.forEach((change, index) => {
      if (seen.has(change.id)) {
        ctx.addIssue({ code: "custom", path: [index, "id"], message: "Duplicate change id." });
      }
      seen.add(change.id);
    });
  });

/** The stored envelope. */
export const storedVisualChangesSchema = z.object({
  schemaVersion: z.literal(VISUAL_CHANGE_SCHEMA_VERSION),
  changes: visualChangesSchema,
});

export type StoredVisualChanges = z.infer<typeof storedVisualChangesSchema>;

/** The value written to `ExperimentVariant.changes`. */
export function toStoredChanges(changes: readonly VisualChange[]): StoredVisualChanges {
  return { schemaVersion: VISUAL_CHANGE_SCHEMA_VERSION, changes: [...changes] };
}

/**
 * The changes in a stored value — the envelope, or a bare array from before the envelope — with
 * anything that no longer validates dropped. Never throws.
 */
export function readStoredChanges(stored: unknown): VisualChange[] {
  const list = Array.isArray(stored)
    ? stored
    : stored &&
        typeof stored === "object" &&
        Array.isArray((stored as { changes?: unknown }).changes)
      ? (stored as { changes: unknown[] }).changes
      : [];
  return list.flatMap((item) => {
    const parsed = visualChangeSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

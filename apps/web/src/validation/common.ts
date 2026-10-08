import { z } from "zod";

/**
 * Primitives reused across every input schema.
 *
 * Validation lives here rather than inside services so a single definition covers Server
 * Actions, route handlers and tests, and so error messages stay identical wherever an input
 * arrives from.
 */

/**
 * A record identifier, as produced by `@default(cuid())`.
 *
 * Hyphens and underscores are allowed as well as alphanumerics, because the id formats this
 * database actually contains are wider than cuid alone: UUIDs carry hyphens, and nanoid uses
 * both. The previous alphanumeric-only rule rejected every UUID, which made any experiment
 * holding a UUID variant id impossible to save — the form submitted an id the schema refused.
 *
 * Still deliberately narrow: no dots, no slashes, no whitespace, capped at 64 characters, so
 * path traversal and injection-shaped input are rejected. The real protection is that ids only
 * ever reach Prisma as bound parameters; this is the sanity check in front of it.
 */
export const idSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(64, "Too long")
  .regex(/^[a-z0-9_-]+$/i, "Invalid identifier");

/** Public site identifier embedded in the tracking snippet. Not a secret — it is visible in
 * page source by design, and grants no access beyond appending events to that website. */
export const publicSiteIdSchema = z
  .string()
  .trim()
  .regex(/^rt_[a-z0-9]{24,48}$/i, "Invalid public site id");

const MAX_URL_LENGTH = 2048;

/**
 * An absolute http(s) URL.
 *
 * `javascript:` and `data:` URLs parse successfully as URLs, so the protocol is checked
 * explicitly — an experiment URL ends up in a `location.replace()` call in the browser, and
 * an unvalidated scheme there is a cross-site scripting vector.
 */
export const absoluteUrlSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(MAX_URL_LENGTH, `Must be ${MAX_URL_LENGTH} characters or fewer`)
  .superRefine((value, ctx) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full URL, including https://" });
      return;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({ code: "custom", message: "Only http:// and https:// URLs are supported" });
    }
  });

/** Inclusive date range used by dashboard queries. */
export const dateRangeSchema = z
  .object({
    from: z.date(),
    to: z.date(),
  })
  .refine((range) => range.from <= range.to, {
    message: "The start of the range must not be after its end",
    path: ["from"],
  });

export type DateRange = z.infer<typeof dateRangeSchema>;

/**
 * An IANA time zone such as `Europe/London` or `America/New_York`.
 *
 * Checked by asking the runtime's own time-zone database rather than a hard-coded list: the
 * same database is what later formats reporting days, so anything it accepts here it can use.
 */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Choose a time zone.")
  .max(64, "Choose a time zone.")
  .refine((zone) => isValidTimeZone(zone), "Choose a valid time zone, e.g. Europe/London.");

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** An email address, lowercased. Deliberately simple: the prototype's own rule. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Enter a valid email address.")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address.");

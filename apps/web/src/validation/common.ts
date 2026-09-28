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

/**
 * A bare hostname such as `acme.com` or `shop.acme.co.uk`.
 * Accepts a pasted URL and reduces it to its host, because that is what users usually paste.
 */
export const domainSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(253, "Too long")
  .transform((value) => {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      return new URL(withScheme).hostname.toLowerCase();
    } catch {
      return value.toLowerCase();
    }
  })
  .refine(
    (host) => /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(host),
    "Enter a valid domain, for example acme.com",
  );

/** Human-readable name for a website or experiment. */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(120, "Must be 120 characters or fewer");

/** Percentage of visitors on the control page entered into an experiment at all. */
export const trafficAllocationSchema = z
  .number()
  .int("Must be a whole number")
  .min(1, "Must be at least 1%")
  .max(100, "Must be at most 100%");

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

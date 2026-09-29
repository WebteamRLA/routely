import { z } from "zod";

import { isUtcDayKey } from "@/lib/utc-day";
import { idSchema } from "@/validation/common";

/**
 * Inputs for the Google Sheets integration.
 *
 * The spreadsheet id is the one field here that is a security control rather than a convenience.
 * It is interpolated into a Google API **URL path** (`/v4/spreadsheets/{id}/values/{range}:append`),
 * so an unvalidated value containing a slash could address a different method on the same API
 * than the one intended. It is validated against a strict character class *and* percent-encoded
 * at the call site — either alone would probably do, and the combination costs nothing.
 */

/**
 * A Google Drive file id.
 *
 * Google does not document a fixed length, so the bound is deliberately generous: the point of
 * the rule is the character class, not the size. Real spreadsheet ids are ~44 characters of
 * base64url-ish text.
 */
export const spreadsheetIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,100}$/, "That does not look like a Google Sheets id");

/**
 * A spreadsheet, given either as its id or as any URL containing one.
 *
 * Normally the id arrives straight from the Google Picker, already clean. The URL form is kept as a
 * fallback for the case where the Picker cannot load — a blocked third-party script, an offline
 * moment — so a customer is never stranded with no way to name a spreadsheet. They copy the address
 * bar; asking them to extract a 44-character id from it by hand is how a form gets filled in
 * wrongly.
 */
export const spreadsheetRefSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(2048, "Too long")
  .transform((value, ctx) => {
    // `/spreadsheets/d/<id>` is the canonical shape; `?id=<id>` appears in older links.
    const fromPath = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/.exec(value);
    const fromQuery = /[?&]id=([A-Za-z0-9_-]{20,100})(?:&|$)/.exec(value);
    const candidate = fromPath?.[1] ?? fromQuery?.[1] ?? value;

    const parsed = spreadsheetIdSchema.safeParse(candidate);

    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: "Paste the spreadsheet's web address, or its id",
      });
      return z.NEVER;
    }

    return parsed.data;
  });

/**
 * A worksheet's `gid`.
 *
 * Stored rather than the tab's title, because renaming a tab in Sheets changes the title and
 * notifies nobody — a stored title would silently start addressing a tab that no longer exists,
 * or worse, a different one that has since taken the name. `0` is the gid of the first sheet in
 * every new spreadsheet, so zero is valid and the field is nullable rather than defaulted.
 */
export const sheetGidSchema = z
  .number()
  .int("Must be a whole number")
  .min(0, "Must not be negative")
  // Sheets gids are 32-bit.
  .max(2_147_483_647, "Too large");

/**
 * The destination form's payload.
 *
 * `websiteId` is here because a destination belongs to a website, and the website arrives from the
 * client like any other id — it is validated and then resolved through the actor's ownership, never
 * trusted on its own.
 */
export const sheetTargetSchema = z.object({
  websiteId: idSchema,
  spreadsheetId: spreadsheetRefSchema,
  sheetId: sheetGidSchema,
});

export type SheetTargetInput = z.infer<typeof sheetTargetSchema>;

/**
 * A UTC calendar day, `YYYY-MM-DD`.
 *
 * Refined rather than merely pattern-matched, so `2026-02-30` is rejected here instead of
 * becoming 2 March somewhere downstream.
 */
export const dayKeySchema = z
  .string()
  .trim()
  .refine(isUtcDayKey, "Must be a real date in YYYY-MM-DD form");

import { z } from "zod";

/**
 * Inputs for sign-in, sign-up, password reset and Settings → Profile & security.
 *
 * Every message is the design's copy, verbatim (Settings) or the spec's proposal (the undesigned
 * auth screens, spec §7). These schemas run on the server through `parseOrThrow` and in the
 * browser through `firstErrors`, so the copy a field shows before submitting is the copy the server
 * would send back.
 *
 * Plain Zod, no server imports: client components use this module.
 */

/** The design's own test — loose on purpose; the inbox decides whether an address is real. */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "Enter a valid email address, like name@company.com.")
  .regex(EMAIL_PATTERN, "Enter a valid email address, like name@company.com.");

const name = z.string().trim().min(1, "Enter your name.").max(80, "Use 80 characters or fewer.");

/** "Enter a new password." / length rules, in the design's order. */
function newPasswordIssue(value: string): string | null {
  if (!value) return "Enter a new password.";
  if (value.length < 8) return "Use at least 8 characters.";
  if (value.length > 128) return "Use 128 characters or fewer.";
  return null;
}

/** Sign-in: only presence is checked — a length rule here would hint at which part was wrong. */
export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(1024, "Enter your password."),
});

export const signUpSchema = z.object({
  name,
  email,
  password: z
    .string()
    .min(1, "Enter a password.")
    .min(8, "Use at least 8 characters.")
    .max(128, "Use 128 characters or fewer."),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: z.string().max(1024), confirm: z.string().max(1024) })
  .superRefine((v, ctx) => {
    const problem = newPasswordIssue(v.password);
    if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
    if (!v.confirm) {
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "Enter the new password again." });
    } else if (v.confirm !== v.password) {
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "Passwords don’t match." });
    }
  });

export const profileSchema = z.object({ name, email });

/**
 * Change password. `current` is optional only for an account that has none yet (Google-only),
 * which the service decides — the schema cannot know.
 */
export const changePasswordSchema = z
  .object({
    current: z.string().max(1024),
    next: z.string().max(1024),
    confirm: z.string().max(1024),
    hasPassword: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    if (v.hasPassword && !v.current) issue("current", "Enter your current password.");

    const problem = newPasswordIssue(v.next);
    if (problem) issue("next", problem);
    else if (v.hasPassword && v.next === v.current)
      issue("next", "Choose a password that’s different from your current one.");

    if (!v.confirm) issue("confirm", "Enter the new password again.");
    else if (v.confirm !== v.next) issue("confirm", "Passwords don’t match.");
  });

/** A raw token from an emailed link: 32 random bytes, base64url. */
export const tokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{32,128}$/, "That link isn’t valid.");

/**
 * The first message per field, for a form to render beside each input. Keys absent from the
 * result are valid. Zod reports issues in the order the rules are declared, so "Enter a new
 * password." wins over "Use at least 8 characters." for an empty field.
 */
export function firstErrors<T extends z.ZodType>(
  schema: T,
  input: unknown,
): Partial<Record<string, string>> {
  const result = schema.safeParse(input);
  if (result.success) return {};
  const out: Partial<Record<string, string>> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "_form");
    out[key] ??= issue.message;
  }
  return out;
}

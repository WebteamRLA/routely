import { z } from "zod";

import { InstallMethod, SiteProtocol } from "@/generated/prisma/enums";
import { isValidDomain, normDomain } from "@/lib/domain-normalize";
import { absoluteUrlSchema, idSchema, timezoneSchema } from "@/validation/common";

/**
 * Website ("project" in the UI) inputs.
 */

/** Scheme the site is served over. Defaults to https — http is the local-development case. */
export const siteProtocolSchema = z.enum(SiteProtocol).default("HTTPS");

/**
 * Whatever someone typed into a website field, reduced to a bare host: `normDomain` (protocol,
 * `www.` and any path stripped), validated, then **without a port** — a port is part of a URL,
 * not of a domain, and `isSameSite` compares hostnames, so a stored `acme.test:3000` could never
 * match any experiment URL.
 */
export function projectDomainSchema(messages: { required: string; invalid: string }) {
  return z
    .string({ error: messages.required })
    .trim()
    .min(1, messages.required)
    .max(253, messages.invalid)
    .transform((raw) => normDomain(raw))
    .refine((domain) => isValidDomain(domain), messages.invalid)
    .transform((domain) => domain.replace(/:\d+$/, ""));
}

const primaryDomainSchema = projectDomainSchema({
  required: "Enter your website URL.",
  invalid: "Enter a valid website, e.g. https://www.example.com",
});

export const projectNameSchema = z
  .string({ error: "Enter a project name." })
  .trim()
  .min(2, "Enter a project name.")
  .max(120, "Must be 120 characters or fewer");

/** 90, 95 or 99 — stored as a percentage. Accepts the fraction form (0.95) too. */
export const significanceThresholdSchema = z.coerce
  .number()
  .transform((value) => (value > 0 && value < 1 ? Math.round(value * 100) : value))
  .refine((value) => value === 90 || value === 95 || value === 99, "Choose 90%, 95% or 99%.");

export const installMethodSchema = z
  .enum(["direct", "gtm", "MANUAL", "GTM"])
  .transform((value) =>
    value === "gtm" || value === "GTM" ? InstallMethod.GTM : InstallMethod.MANUAL,
  );

/** `http://…` typed in the website field means the site is served over http. */
export function protocolFromInput(raw: unknown): "HTTP" | "HTTPS" {
  return typeof raw === "string" && /^\s*http:\/\//i.test(raw) ? "HTTP" : "HTTPS";
}

export const createProjectSchema = z.object({
  name: projectNameSchema,
  domain: primaryDomainSchema,
  protocol: siteProtocolSchema,
});

export const updateProjectSchema = z.object({
  projectId: idSchema,
  name: projectNameSchema.optional(),
  domain: primaryDomainSchema.optional(),
  protocol: z.enum(SiteProtocol).optional(),
  timezone: timezoneSchema.optional(),
  significanceThreshold: significanceThresholdSchema.optional(),
  installMethod: installMethodSchema.optional(),
});

export const addDomainSchema = z.object({
  projectId: idSchema,
  domain: projectDomainSchema({
    required: "Enter a domain like shop.example.com",
    invalid: "Enter a domain like shop.example.com",
  }),
});

export const removeDomainSchema = z.object({
  projectId: idSchema,
  domain: z.string().trim().toLowerCase().min(1, "Required").max(253),
});

export const projectIdSchema = z.object({ projectId: idSchema });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// -------------------------------------------------------------------------------------------
// Install check
// -------------------------------------------------------------------------------------------

/** Input for the install check: which website, and which of its pages to look at. */
export const verifyInstallationSchema = z.object({
  websiteId: idSchema,
  url: absoluteUrlSchema,
});

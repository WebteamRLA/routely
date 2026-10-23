import { z } from "zod";

import { SiteProtocol } from "@/generated/prisma/enums";
import {
  normalizeDomain,
  projectAddressError,
  projectNameError,
  protocolFromAddress,
} from "@/lib/projects";
import { absoluteUrlSchema, displayNameSchema, domainSchema, idSchema } from "@/validation/common";

/** Scheme the site is served over. Defaults to https — http is the local-development case. */
export const siteProtocolSchema = z.enum(SiteProtocol).default("HTTPS");

/** Input for creating a website. The public site id is generated server-side, never supplied. */
export const createWebsiteSchema = z.object({
  name: displayNameSchema,
  domain: domainSchema,
  protocol: siteProtocolSchema,
});

export const updateWebsiteSchema = z.object({
  websiteId: idSchema,
  name: displayNameSchema.optional(),
  domain: domainSchema.optional(),
  protocol: siteProtocolSchema.optional(),
});

export const websiteIdSchema = z.object({
  websiteId: idSchema,
});

/** Input for the install check: which website, and which of its pages to look at. */
export const verifyInstallationSchema = z.object({
  websiteId: idSchema,
  url: absoluteUrlSchema,
});

export type CreateWebsiteInput = z.infer<typeof createWebsiteSchema>;
export type UpdateWebsiteInput = z.infer<typeof updateWebsiteSchema>;

// ---------------------------------------------------------------------------------------------
// Projects (the new design's create / edit / delete dialogs)
// ---------------------------------------------------------------------------------------------

/**
 * A project name: trimmed, 1–60 characters, with the design's own messages. The rule is
 * `lib/projects.ts`'s, so the dialog's instant check and this one cannot disagree.
 * (`displayNameSchema` allows 120 and stays for the pre-design pages.)
 */
export const projectNameSchema = z
  .string({ error: "Give your project a name." })
  .trim()
  .superRefine((value, ctx) => {
    const message = projectNameError(value);
    if (message) ctx.addIssue({ code: "custom", message });
  });

/**
 * A typed website address, reduced to what is stored: `{ domain, protocol }`. Accepts what people
 * paste ("https://www.shop.example.com/path") and normalises it the way the dialog previews it;
 * a typed `http://` keeps the site on HTTP, anything else is HTTPS.
 */
export const projectAddressSchema = z
  .string({ error: "Enter your website’s address." })
  .superRefine((value, ctx) => {
    const message = projectAddressError(value);
    if (message) ctx.addIssue({ code: "custom", message });
  })
  .transform((value) => ({
    domain: normalizeDomain(value),
    protocol: protocolFromAddress(value),
  }));

/** Field names match the dialogs' inputs, so a field error lands beside the right box. */
export const createProjectSchema = z.object({
  name: projectNameSchema,
  url: projectAddressSchema,
});

export const updateProjectSchema = z.object({
  websiteId: idSchema,
  name: projectNameSchema,
  url: projectAddressSchema,
});

/**
 * Deleting a project re-checks the typed confirmation on the server: the button is enabled only
 * when it matches, but a Server Action is a public endpoint and the check costs nothing.
 */
export const deleteProjectSchema = z.object({
  websiteId: idSchema,
  confirmName: z.string({ error: "Type the project’s name to confirm." }).max(200),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

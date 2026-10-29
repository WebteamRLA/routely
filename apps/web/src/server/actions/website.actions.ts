"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { SiteProtocol } from "@/generated/prisma/enums";
import type { Project } from "@/lib/projects";
import { routes } from "@/lib/routes";
import { type FormState, runAction } from "@/server/actions/types";
import { requireUser } from "@/server/auth/session";
import { isAppError, toPublicError } from "@/server/errors";
import * as pixelService from "@/server/services/pixel.service";
import * as projectService from "@/server/services/project.service";
import * as websiteService from "@/server/services/website.service";

/**
 * Server Actions for website management.
 *
 * Each one re-establishes the actor from the session rather than trusting anything in the
 * submitted form: a Server Action is a public HTTP endpoint, and a `userId` arriving in a
 * form field would be attacker-supplied. The service layer then scopes every query by that
 * actor, so an id belonging to someone else resolves to "not found".
 */

export async function createWebsiteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const result = await runAction(() =>
    websiteService.createWebsite(user.id, user.workspaceId, {
      name: formData.get("name"),
      domain: formData.get("domain"),
      protocol: formData.get("protocol") ?? undefined,
    }),
  );

  if (!result.ok) {
    return result.state;
  }

  // Outside runAction: redirect() signals by throwing, and must reach Next.js uncaught.
  redirect(routes.websites.detail(result.data.id));
}

export interface CreateWebsiteInlineState extends FormState {
  /** Present on success, for a caller that needs the created row without navigating away. */
  website?: {
    id: string;
    name: string;
    domain: string;
    protocol: SiteProtocol;
    publicSiteId: string;
  };
}

/**
 * Same creation as `createWebsiteAction`, for a caller that can't navigate away — the
 * experiment wizard's "Add another website" dialog, which needs to select the new website and
 * keep going rather than leaving the flow it was opened from.
 */
export async function createWebsiteInlineAction(
  _previous: CreateWebsiteInlineState,
  formData: FormData,
): Promise<CreateWebsiteInlineState> {
  const user = await requireUser();

  const result = await runAction(() =>
    websiteService.createWebsite(user.id, user.workspaceId, {
      name: formData.get("name"),
      domain: formData.get("domain"),
      // Absent means "not specified", which the schema turns into the https default. A null
      // from `formData.get` would fail the enum instead of taking that default.
      protocol: formData.get("protocol") ?? undefined,
    }),
  );

  if (!result.ok) {
    return result.state;
  }

  return {
    status: "success",
    website: {
      id: result.data.id,
      name: result.data.name,
      domain: result.data.domain,
      protocol: result.data.protocol,
      publicSiteId: result.data.publicSiteId,
    },
  };
}

export async function updateWebsiteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");

  const result = await runAction(() =>
    websiteService.updateWebsite(user.id, {
      websiteId,
      name: formData.get("name"),
      domain: formData.get("domain"),
      protocol: formData.get("protocol") ?? undefined,
    }),
  );

  if (!result.ok) {
    return result.state;
  }

  revalidatePath(routes.websites.detail(websiteId));

  return { status: "success", message: "Website updated." };
}

/**
 * Deletes every selected website.
 *
 * Ids arrive as repeated `websiteId` fields, and ownership is enforced inside the delete's own
 * where clause — so an id belonging to someone else contributes nothing rather than erroring,
 * and the count that comes back reflects only what the actor actually owned.
 *
 * Stays on the page rather than redirecting: the table it was triggered from is still the right
 * place to be afterwards.
 */
export async function deleteWebsitesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const websiteIds = formData.getAll("websiteId").map(String).filter(Boolean);

  if (websiteIds.length === 0) {
    return { status: "error", message: "Select at least one website to delete." };
  }

  const result = await runAction(() => websiteService.deleteWebsites(user.id, websiteIds));

  if (!result.ok) {
    return result.state;
  }

  revalidatePath(routes.getStarted);

  return {
    status: "success",
    message: `Deleted ${result.data} website${result.data === 1 ? "" : "s"}.`,
  };
}

export async function deleteWebsiteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");

  const result = await runAction(() => websiteService.deleteWebsite(user.id, websiteId));

  if (!result.ok) {
    return result.state;
  }

  redirect(routes.experiments.list);
}

/**
 * Issues a new public site id. Separated from `updateWebsiteAction` because it breaks every
 * installed snippet for the website — that is a decision, not an edit.
 */
export async function regenerateSiteIdAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const websiteId = String(formData.get("websiteId") ?? "");

  const result = await runAction(() => websiteService.rotatePublicSiteId(user.id, websiteId));

  if (!result.ok) {
    return result.state;
  }

  revalidatePath(routes.websites.detail(websiteId));

  return {
    status: "success",
    message: "New public site id issued. Update the snippet on your website.",
  };
}

// ---------------------------------------------------------------------------------------------
// Projects — the new design's dialogs (Dashboard, Projects, Project dashboard)
// ---------------------------------------------------------------------------------------------

/**
 * Result of a project action. Plain data, because these are called directly from client
 * components (not through `useActionState`) and a thrown `AppError` would cross the boundary as
 * `{}`. `fieldErrors` carries the first message per field, keyed by the dialog's input names
 * (`name`, `url`, `confirmName`).
 */
export type ProjectActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

async function runProjectAction<T>(operation: () => Promise<T>): Promise<ProjectActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const { code, message } = toPublicError(error);
    const fieldErrors: Record<string, string> = {};
    if (isAppError(error)) {
      for (const [key, messages] of Object.entries(error.fieldErrors ?? {})) {
        if (messages[0]) fieldErrors[key] = messages[0];
      }
    }
    return {
      ok: false,
      code,
      message,
      ...(Object.keys(fieldErrors).length ? { fieldErrors } : {}),
    };
  }
}

/** Every screen that lists or shows projects. */
function revalidateProjectViews(websiteId?: string): void {
  revalidatePath(routes.dashboard);
  revalidatePath(routes.projects.list);
  if (websiteId) revalidatePath(routes.projects.detail(websiteId));
}

/**
 * Creates a project in the actor's active workspace (Owner/Admin) and returns its Projects row,
 * so the caller can open the pixel dialog for it straight away.
 */
export async function createProjectAction(input: {
  name: string;
  url: string;
}): Promise<ProjectActionResult<Project>> {
  const result = await runProjectAction(async () => {
    const user = await requireUser();
    const { id } = await websiteService.createProject(user.id, user.workspaceId, {
      name: input?.name,
      url: input?.url,
    });
    return projectService.getProjectRow(user.id, id);
  });
  if (result.ok) revalidateProjectViews(result.data.id);
  return result;
}

/** Renames / re-addresses a project (Owner/Admin). Returns the refreshed row. */
export async function updateProjectAction(input: {
  websiteId: string;
  name: string;
  url: string;
}): Promise<ProjectActionResult<Project>> {
  const result = await runProjectAction(async () => {
    const user = await requireUser();
    const { id } = await websiteService.updateProject(user.id, {
      websiteId: input?.websiteId,
      name: input?.name,
      url: input?.url,
    });
    return projectService.getProjectRow(user.id, id);
  });
  if (result.ok) revalidateProjectViews(result.data.id);
  return result;
}

/** Deletes a project once its name has been typed to confirm (Owner/Admin). */
export async function deleteProjectAction(input: {
  websiteId: string;
  confirmName: string;
}): Promise<ProjectActionResult<{ name: string }>> {
  const result = await runProjectAction(async () => {
    const user = await requireUser();
    return websiteService.deleteProject(user.id, {
      websiteId: input?.websiteId,
      confirmName: input?.confirmName,
    });
  });
  if (result.ok) revalidateProjectViews();
  return result;
}

/** What the pixel dialogs render from one install check. Dates as ISO strings. */
export interface PixelCheckData {
  pageLoaded: boolean;
  loadError: string | null;
  scriptFound: boolean;
  antiFlickerFound: boolean;
  wrongSiteId: boolean;
  /** Other projects' IDs the page carries — named in the "Different Project ID" row. */
  foundSiteIds: string[];
  /** The project's real last hit — never a fabricated "just now" (spec §8 row 10). */
  lastSeenAt: string | null;
}

/**
 * Runs the install check for the pixel dialogs (Editor+, rate-limited). A page that fails to load
 * is a result, not an error; an off-site URL or too many checks come back as `ok: false`.
 */
export async function verifyProjectPixelAction(input: {
  websiteId: string;
  url: string;
}): Promise<ProjectActionResult<PixelCheckData>> {
  const result = await runProjectAction(async () => {
    const user = await requireUser();
    const check = await pixelService.verifyInstallation(user.id, {
      websiteId: input?.websiteId,
      url: input?.url,
    });
    return {
      pageLoaded: check.pageLoaded,
      loadError: check.loadError,
      scriptFound: check.scriptFound,
      antiFlickerFound: check.antiFlickerFound,
      wrongSiteId: check.wrongSiteId,
      foundSiteIds: check.otherSiteIds,
      lastSeenAt: check.lastSeenAt ? check.lastSeenAt.toISOString() : null,
    };
  });
  // A found snippet stamps pixelVerifiedAt, which moves the tracking badges.
  if (result.ok && result.data.scriptFound) revalidateProjectViews(String(input?.websiteId ?? ""));
  return result;
}

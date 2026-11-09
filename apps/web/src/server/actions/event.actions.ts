"use server";

import { revalidatePath } from "next/cache";

import type { EventTagStatus } from "@/lib/gtm-event";
import { routes } from "@/lib/routes";
import { type ActionResult, toActionResult } from "@/server/actions/result";
import { requireUser } from "@/server/auth/session";
import * as eventService from "@/server/services/custom-event.service";
import type { EventLibrary } from "@/server/services/custom-event.service";

/** The Event Library. The actor always comes from the session; ids only name rows. */

export async function createEventAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const result = await toActionResult(async () => {
    const user = await requireUser();
    return eventService.createEvent(user.id, input);
  });
  revalidateLibrary(input);
  return result;
}

export async function updateEventAction(id: string, input: unknown): Promise<ActionResult<null>> {
  const result = await toActionResult(async () => {
    const user = await requireUser();
    await eventService.updateEvent(user.id, id, input);
    return null;
  });
  revalidateLibrary(input);
  return result;
}

export async function deleteEventAction(
  id: string,
  websiteId: string,
): Promise<ActionResult<null>> {
  const result = await toActionResult(async () => {
    const user = await requireUser();
    await eventService.deleteEvent(user.id, id);
    return null;
  });
  revalidateLibrary({ websiteId });
  return result;
}

/** Whether an event's Google Tag Manager tag is published on a page. Changes nothing. */
export async function checkEventTagAction(input: unknown): Promise<ActionResult<EventTagStatus>> {
  return toActionResult(async () => {
    const user = await requireUser();
    return eventService.checkEventTag(user.id, input);
  });
}

/** The library as it stands now, for the page's refresh and the wizards' goal step. */
export async function getEventLibraryAction(
  websiteId: string,
): Promise<ActionResult<EventLibrary>> {
  return toActionResult(async () => {
    const user = await requireUser();
    return eventService.getEventLibrary(user.id, websiteId);
  });
}

function revalidateLibrary(input: unknown): void {
  const websiteId = (input as { websiteId?: unknown } | null)?.websiteId;
  if (typeof websiteId !== "string") return;
  revalidatePath(routes.projects.events(websiteId));
  revalidatePath(routes.metrics.list);
}

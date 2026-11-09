import "server-only";

import type { EventDefinition, Prisma } from "@/generated/prisma/client";
import { type EventStatus, eventStatus, submissionUnverified } from "@/lib/events";
import { type EventTagStatus, eventTagStatus } from "@/lib/gtm-event";
import { type MemberRole, can, rolesWith } from "@/lib/permissions";
import { isSameSite } from "@/lib/url";
import { conflict, forbidden, notFound, rateLimited, validationFailed } from "@/server/errors";
import { rateLimit } from "@/server/http/rate-limit";
import * as customEventRepo from "@/server/repositories/custom-event.repository";
import * as definitionRepo from "@/server/repositories/event-definition.repository";
import type { EventDefinitionWithUsage } from "@/server/repositories/event-definition.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { inspectEventTag } from "@/server/services/pixel.service";
import { parseOrThrow } from "@/server/validate";
import {
  type EventDefinitionInput,
  eventDefinitionSchema,
  eventTagCheckSchema,
} from "@/validation/custom-event";
import { idSchema } from "@/validation/common";

/**
 * A project's Event Library: the events it has set up and what has actually arrived.
 *
 * An event belongs to the project, so one definition can be the goal of many experiments. Anyone
 * in the workspace may read the library; changing it needs `events.manage` (Editors and up).
 * Non-members get NOT_FOUND, members without the role FORBIDDEN (CLAUDE.md §5).
 */

export interface EventUsage {
  id: string;
  name: string;
  status: string;
  type: string;
}

export interface LibraryEvent {
  /** Null for a name that has arrived but was never set up. */
  id: string | null;
  name: string;
  description: string | null;
  category: string | null;
  method: EventDefinition["method"] | null;
  /** What detects a click or form event: the pixel (`MANUAL`) or its own Tag Manager tag. */
  install: EventDefinition["install"];
  selector: string | null;
  pageUrl: string | null;
  pageMatch: EventDefinition["pageMatch"];
  formSuccess: EventDefinition["formSuccess"];
  successUrl: string | null;
  successMatch: EventDefinition["successMatch"];
  successSelector: string | null;
  successEvent: string | null;
  issueUrl: string | null;
  total: number;
  /** ISO time. */
  lastReceivedAt: string | null;
  status: EventStatus;
  /** A form event that cannot tell an accepted submission from a rejected one. */
  unverifiedSubmission: boolean;
  usage: EventUsage[];
}

export interface EventLibrary {
  role: MemberRole;
  events: LibraryEvent[];
}

function toLibraryEvent(
  definition: EventDefinitionWithUsage,
  summary: customEventRepo.EventNameSummary | undefined,
  now: Date,
): LibraryEvent {
  const lastReceivedAt = summary?.lastReceivedAt ?? null;
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    method: definition.method,
    install: definition.install,
    selector: definition.selector,
    pageUrl: definition.pageUrl,
    pageMatch: definition.pageMatch,
    formSuccess: definition.formSuccess,
    successUrl: definition.successUrl,
    successMatch: definition.successMatch,
    successSelector: definition.successSelector,
    successEvent: definition.successEvent,
    issueUrl: definition.issueUrl,
    total: summary?.total ?? 0,
    lastReceivedAt: lastReceivedAt?.toISOString() ?? null,
    status: eventStatus(
      {
        method: definition.method,
        formSuccess: definition.formSuccess,
        issueCode: definition.issueCode,
        total: summary?.total ?? 0,
        lastReceivedAt,
      },
      now,
    ),
    unverifiedSubmission: submissionUnverified(definition.method, definition.formSuccess),
    usage: definition.experiments,
  };
}

function toUndeclaredEvent(summary: customEventRepo.EventNameSummary, now: Date): LibraryEvent {
  return {
    id: null,
    name: summary.name,
    description: null,
    category: null,
    method: null,
    install: "MANUAL",
    selector: null,
    pageUrl: null,
    pageMatch: null,
    formSuccess: null,
    successUrl: null,
    successMatch: "EXACT",
    successSelector: null,
    successEvent: null,
    issueUrl: null,
    total: summary.total,
    lastReceivedAt: summary.lastReceivedAt?.toISOString() ?? null,
    status: eventStatus(
      {
        method: null,
        formSuccess: null,
        issueCode: null,
        total: summary.total,
        lastReceivedAt: summary.lastReceivedAt,
      },
      now,
    ),
    unverifiedSubmission: false,
    usage: [],
  };
}

export async function getEventLibrary(
  actorUserId: string,
  websiteIdInput: unknown,
  now: Date = new Date(),
): Promise<EventLibrary> {
  const websiteId = parseOrThrow(idSchema, websiteIdInput);
  const access = await websiteRepo.findWebsiteAccess(websiteId, actorUserId);
  if (!access) throw notFound("That project does not exist.");

  const [definitions, summaries] = await Promise.all([
    definitionRepo.listDefinitions(websiteId),
    customEventRepo.summarizeByName(websiteId),
  ]);

  const byName = new Map(summaries.map((summary) => [summary.name, summary]));
  const events = definitions.map((definition) =>
    toLibraryEvent(definition, byName.get(definition.name), now),
  );
  const declared = new Set(definitions.map((definition) => definition.name));
  for (const summary of summaries) {
    if (!declared.has(summary.name)) events.push(toUndeclaredEvent(summary, now));
  }

  return { role: access.role, events };
}

/** The configuration columns of an input: a method keeps only the fields it uses. */
function storedFields(
  input: EventDefinitionInput,
): Omit<Prisma.EventDefinitionUncheckedCreateInput, "websiteId" | "name"> {
  const form = input.method === "FORM";
  const success = form ? (input.formSuccess ?? null) : null;
  return {
    description: input.description ?? null,
    category: input.category ?? null,
    method: input.method,
    // Code reports itself; only a click or form has something for GTM to detect.
    install: input.method === "CODE" ? "MANUAL" : (input.install ?? "MANUAL"),
    // A JavaScript event may keep the element its GTM script listens on; the pixel ignores it.
    selector: input.selector ?? null,
    pageUrl: input.pageUrl ?? null,
    pageMatch: input.method === "CODE" ? null : (input.pageMatch ?? null),
    formSuccess: success,
    successUrl: success === "URL" ? (input.successUrl ?? null) : null,
    successMatch: input.successMatch ?? "EXACT",
    successSelector: success === "ELEMENT" ? (input.successSelector ?? null) : null,
    successEvent: success === "CALLBACK" ? (input.successEvent ?? null) : null,
    // A new configuration has not been seen to fail.
    issueCode: null,
    issueUrl: null,
    issueAt: null,
  };
}

/** Same rule as experiment URLs: an event on another site could never be reported here. */
function assertOnSite(input: EventDefinitionInput, domain: string): void {
  const message = `Must be a URL on ${domain} or one of its subdomains.`;
  const offenders: Record<string, string[]> = {};
  if (input.pageUrl && !isSameSite(input.pageUrl, domain)) offenders["pageUrl"] = [message];
  if (input.successUrl && !isSameSite(input.successUrl, domain))
    offenders["successUrl"] = [message];
  if (Object.keys(offenders).length > 0) throw validationFailed(message, offenders);
}

const uniqueNameMessage = "This project already has an event with that name.";

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

export async function createEvent(actorUserId: string, input: unknown): Promise<{ id: string }> {
  const data = parseOrThrow(eventDefinitionSchema, input, "Check the event’s details.");

  const access = await websiteRepo.findWebsiteAccess(data.websiteId, actorUserId);
  if (!access) throw notFound("That project does not exist.");
  if (!can(access.role, "events.manage")) throw forbidden();
  assertOnSite(data, access.website.domain);

  try {
    const { id } = await definitionRepo.createDefinition({
      ...storedFields(data),
      websiteId: access.website.id,
      name: data.name,
      createdById: actorUserId,
    });
    return { id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw validationFailed(uniqueNameMessage, { name: [uniqueNameMessage] });
    }
    throw error;
  }
}

async function editableEvent(actorUserId: string, id: string) {
  const definition = await definitionRepo.findDefinition(id, actorUserId);
  if (!definition) throw notFound("That event does not exist.");
  const access = await websiteRepo.findWebsiteAccess(definition.websiteId, actorUserId);
  if (!access) throw notFound("That event does not exist.");
  if (!can(access.role, "events.manage")) throw forbidden();
  return { definition, website: access.website };
}

const launched = (usage: { status: string }[]) => usage.some((use) => use.status !== "DRAFT");

export async function updateEvent(
  actorUserId: string,
  idInput: unknown,
  input: unknown,
): Promise<void> {
  const id = parseOrThrow(idSchema, idInput);
  const data = parseOrThrow(eventDefinitionSchema, input, "Check the event’s details.");
  const { definition, website } = await editableEvent(actorUserId, id);

  if (data.websiteId !== definition.websiteId) throw notFound("That event does not exist.");
  assertOnSite(data, website.domain);

  // A launched experiment's goal is fixed (D7), and ingestion matches by name.
  if (data.name !== definition.name && launched(definition.experiments)) {
    throw validationFailed("A launched experiment uses this event, so its name can’t change.", {
      name: ["Used by a launched experiment."],
    });
  }

  try {
    const { count } = await definitionRepo.updateDefinition(
      id,
      actorUserId,
      rolesWith("events.manage"),
      { ...storedFields(data), name: data.name },
    );
    if (count === 0) throw notFound("That event does not exist.");
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw validationFailed(uniqueNameMessage, { name: [uniqueNameMessage] });
    }
    throw error;
  }
}

/** Per user, like the install check: each run fetches the page and its containers. */
const TAG_CHECK_RATE_LIMIT = 10;
const TAG_CHECK_RATE_WINDOW_MS = 60_000;

/**
 * The GTM option's check: is this event's tag published in a container the page loads, next to the
 * Routely script it reports through? Read on the server; nothing runs in the customer's browser. It
 * works before the event is saved, since it needs only the name.
 */
export async function checkEventTag(actorUserId: string, input: unknown): Promise<EventTagStatus> {
  const { websiteId, name, url } = parseOrThrow(
    eventTagCheckSchema,
    input,
    "Check the URL you entered.",
  );
  const access = await websiteRepo.findWebsiteAccess(websiteId, actorUserId);
  if (!access) throw notFound("That project does not exist.");
  if (!can(access.role, "events.manage")) throw forbidden();
  const { website } = access;

  if (!isSameSite(url, website.domain)) {
    const message = `Must be a URL on ${website.domain} or one of its subdomains.`;
    throw validationFailed(message, { url: [message] });
  }
  if (
    !rateLimit(`event-tag:${actorUserId}`, TAG_CHECK_RATE_LIMIT, TAG_CHECK_RATE_WINDOW_MS).allowed
  ) {
    throw rateLimited("Too many checks in a minute. Wait a moment and try again.");
  }

  const look = await inspectEventTag(url, website, name);
  if (look.refused) throw validationFailed(look.refused, { url: [look.refused] });
  return eventTagStatus(look);
}

export async function deleteEvent(actorUserId: string, idInput: unknown): Promise<void> {
  const id = parseOrThrow(idSchema, idInput);
  const { definition } = await editableEvent(actorUserId, id);

  if (launched(definition.experiments)) {
    throw conflict("A launched experiment uses this event as its goal, so it can’t be deleted.");
  }
  await definitionRepo.deleteDefinition(id, actorUserId, rolesWith("events.manage"));
}

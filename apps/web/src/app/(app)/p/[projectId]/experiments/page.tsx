import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExperimentsList, type ListItemRow } from "@/components/experiments/list/experiments-list";
import type { StatusFilter } from "@/components/experiments/list/list-toolbar";
import { listRow } from "@/components/experiments/list/row-model";
import { demoState } from "@/lib/demo-state";
import type { ExperimentKind } from "@/lib/domain";
import { requireSession } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import * as experimentService from "@/server/services/experiment.service";
import { getProject } from "@/server/services/website.service";

export const metadata: Metadata = { title: "Experiments" };

type SearchParams = Record<string, string | string[] | undefined>;

const STATUSES = ["all", "running", "draft", "completed", "paused"] as const;
const TYPES = ["all", "redirect", "ab"] as const;
const SORTS = ["updated", "created", "name", "visitors", "cr"] as const;

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = Array.isArray(value) ? value[0] : value;
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export default async function ExperimentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ projectId }, sp, session] = await Promise.all([params, searchParams, requireSession()]);
  const status = pick<StatusFilter>(sp.status, STATUSES, "all");
  const type = pick<ExperimentKind | "all">(sp.type, TYPES, "all");
  const sort = pick(sp.sort, SORTS, "updated");
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.slice(0, 200) ?? "";

  let project;
  let items;
  try {
    [project, items] = await Promise.all([
      getProject(session.user.id, projectId),
      experimentService.listForProject(session.user.id, projectId, { status, type, q, sort }),
    ]);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const rows: ListItemRow[] = items.map((e) => ({
    ...listRow(e, project.threshold, project.timezone),
    status: e.status,
    displayStatus: e.displayStatus,
  }));
  const c = project.counts;

  return (
    <ExperimentsList
      projectId={project.id}
      domain={project.domain}
      rows={rows}
      counts={{
        all: c.total,
        running: c.running,
        draft: c.draft,
        completed: c.completed,
        paused: c.paused,
      }}
      filters={{ status, type, q, sort }}
      demo={demoState(sp)}
    />
  );
}

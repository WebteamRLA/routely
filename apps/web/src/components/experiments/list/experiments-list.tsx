"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EmptyCard, ErrorCard, type MenuItem, PageTitle, Section } from "@/components/rl";
import { Button } from "@/components/ui/button";
import type { DemoState } from "@/lib/demo-state";
import type { DisplayStatusKey, ExperimentStatusKey } from "@/lib/domain";
import { menuFor } from "@/lib/experiment-menu";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { DeleteExperimentModal } from "../delete-experiment-modal";
import { useExperimentActions } from "../use-experiment-actions";
import { ExperimentCards, ExperimentTable, type TableRow } from "./experiment-table";
import { ListToolbar, type StatusFilter } from "./list-toolbar";
import { ListSkeleton } from "./list-skeleton";
import type { ListRow } from "./row-model";

export interface ListItemRow extends ListRow {
  status: ExperimentStatusKey;
  displayStatus: DisplayStatusKey;
}

/** The Experiments list (prototype §2.3, L650–775). */
export function ExperimentsList({
  projectId,
  domain,
  rows,
  counts,
  filters,
  demo,
}: {
  projectId: string;
  domain: string;
  rows: ListItemRow[];
  counts: Record<StatusFilter, number>;
  filters: { status: StatusFilter; type: string; q: string; sort: string };
  demo: DemoState;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const project = routes.project(projectId);
  const actions = useExperimentActions(projectId);
  const [filtering, setFiltering] = useState(false);
  const [, startClear] = useTransition();
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const total = demo === "empty" ? 0 : counts.all;
  const shownCounts =
    demo === "empty" ? { all: 0, draft: 0, running: 0, paused: 0, completed: 0 } : counts;
  const visible = demo === "empty" ? [] : rows;

  const tableRows: TableRow[] = visible.map((r) => ({
    ...r,
    href: project.experiment(r.id),
    menu: menuFor(r.status).map<MenuItem>((m) => ({
      label: m.label,
      tone: m.danger ? "danger" : "default",
      disabled: actions.pending,
      onSelect: () => {
        if (m.key === "continue") router.push(project.editExperiment(r.id));
        else if (m.key === "view") router.push(project.experiment(r.id));
        else if (m.key === "pause") actions.pause(r.id);
        else if (m.key === "resume") actions.resume(r.id);
        else if (m.key === "duplicate") actions.duplicate(r.id);
        else if (m.key === "delete") setDeleting({ id: r.id, name: r.name });
      },
    })),
  }));

  const filtered = filters.status !== "all" || filters.type !== "all" || !!filters.q;

  return (
    <div className="mx-auto flex max-w-[1320px] animate-rl-in flex-col gap-[18px]">
      <PageTitle
        title="Experiments"
        sub={`${shownCounts.all} experiment${shownCounts.all === 1 ? "" : "s"} · ${shownCounts.running} running · ${domain}`}
        actions={
          <Button asChild size="lg">
            <Link href={project.newExperiment()}>+ New experiment</Link>
          </Button>
        }
      />

      <ListToolbar
        counts={shownCounts}
        status={filters.status}
        type={filters.type}
        q={filters.q}
        sort={filters.sort}
        onPending={setFiltering}
      />

      {demo === "loading" ? (
        <ListSkeleton />
      ) : demo === "error" ? (
        <ErrorCard
          title="Experiments failed to load"
          body="The request didn’t complete. Nothing has changed with your running experiments."
          action={
            <Button variant="dark" size="sm" className="h-9" onClick={() => router.refresh()}>
              Retry
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyCard
          title="No experiments yet"
          body="Create your first test. Split URL tests compare two different pages; A/B tests change elements on one page."
          actions={
            <>
              <Button asChild variant="outline">
                <Link href={project.newExperiment("redirect")}>New split URL test</Link>
              </Button>
              <Button asChild>
                <Link href={project.newExperiment("ab")}>New A/B test</Link>
              </Button>
            </>
          }
        />
      ) : visible.length === 0 ? (
        <Section as="div" className="px-6 py-10 text-center">
          <div className="font-heading text-[17px] font-semibold">
            No experiments match these filters
          </div>
          <div className="mt-1.5 mb-3.5 text-ink-3">Try a different search term or status.</div>
          {filtered ? (
            <Button
              variant="outline"
              className="h-9"
              onClick={() => {
                const sort = filters.sort !== "updated" ? `?sort=${filters.sort}` : "";
                startClear(() => router.replace(pathname + sort, { scroll: false }));
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </Section>
      ) : (
        <div className={cn("transition-opacity", filtering && "opacity-60")}>
          <ExperimentTable rows={tableRows} onOpen={(href) => router.push(href)} />
          <ExperimentCards rows={tableRows} onOpen={(href) => router.push(href)} />
        </div>
      )}

      <DeleteExperimentModal
        open={deleting !== null}
        name={deleting?.name ?? ""}
        pending={actions.pending}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          if (await actions.remove(deleting.id)) setDeleting(null);
        }}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, MoreVertical, Trash2 } from "lucide-react";

import { DeleteMetricsDialog } from "@/components/metrics/delete-metrics-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FormState } from "@/lib/form-state";
import { formatDate, formatNumber } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { Metric, MetricState } from "@/server/services/metrics.service";

/**
 * The metrics list, with selection and deletion.
 *
 * **Deleting a metric deletes its experiment.** A goal is a required field on an experiment —
 * one without a goal could never record a conversion — so there is no "remove the goal, keep
 * the test". Every path to deletion here names that consequence before it asks, rather than
 * discovering it afterwards from a shorter experiments list.
 */

const STATE: Record<MetricState, { label: string; hint: string; tone: string }> = {
  collecting: {
    label: "Collecting",
    hint: "Recording conversions",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  },
  waiting: {
    label: "Waiting",
    hint: "Waiting for first conversion",
    tone: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
  },
  paused: {
    label: "Paused",
    hint: "Its experiment is paused",
    tone: "bg-muted text-muted-foreground ring-border",
  },
  draft: {
    label: "Not live",
    hint: "Its experiment hasn't launched",
    tone: "bg-muted text-muted-foreground ring-border",
  },
  archived: {
    label: "Completed",
    hint: "Its experiment has ended",
    tone: "bg-muted text-muted-foreground ring-border",
  },
};

function typeLabel(metric: Metric): string {
  return metric.matchType === "PREFIX" ? "Pageview (Prefix)" : "Pageview (Exact)";
}

export function MetricsTable({
  metrics,
  deleteAction,
}: {
  metrics: Metric[];
  deleteAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Metric[] | null>(null);

  const byId = new Map(metrics.map((metric) => [metric.experimentId, metric]));
  // Ids that no longer exist are dropped, so a deletion or a filter change cannot leave a
  // selection pointing at rows that are not on screen.
  const visibleSelected = selected.filter((id) => byId.has(id));
  const allSelected = metrics.length > 0 && visibleSelected.length === metrics.length;

  function toggle(id: string, checked: boolean) {
    setSelected((previous) =>
      checked ? [...new Set([...previous, id])] : previous.filter((value) => value !== id),
    );
  }

  return (
    <>
      {visibleSelected.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
          <p className="text-sm">
            <span className="font-medium tabular-nums">{visibleSelected.length}</span> selected
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setPendingDelete(visibleSelected.map((id) => byId.get(id)!))}
            >
              <Trash2 aria-hidden />
              Delete selected
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="w-10 px-4 py-2.5">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked === true ? metrics.map((metric) => metric.experimentId) : [],
                    )
                  }
                  aria-label={allSelected ? "Clear selection" : "Select every metric"}
                />
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Metric
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Type
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Conversions (24h)
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Action
              </th>
            </tr>
          </thead>

          <tbody>
            {metrics.map((metric) => {
              const state = STATE[metric.state];
              const isSelected = visibleSelected.includes(metric.experimentId);

              return (
                <tr
                  key={metric.experimentId}
                  data-selected={isSelected || undefined}
                  className="border-b border-border last:border-0 data-[selected]:bg-muted/30"
                >
                  <td className="px-4 py-3.5 align-top">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => toggle(metric.experimentId, checked === true)}
                      aria-label={`Select ${metric.name}`}
                    />
                  </td>

                  <td className="px-4 py-3.5 align-top">
                    <p className="font-medium">{metric.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {metric.experimentName} · {metric.websiteName}
                    </p>
                  </td>

                  <td className="px-4 py-3.5 align-top">
                    <p className="flex items-center gap-1.5 text-sm">
                      <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      {typeLabel(metric)}
                    </p>
                    <p className="mt-0.5 max-w-[24rem] truncate font-mono text-xs text-muted-foreground">
                      {metric.url}
                    </p>
                  </td>

                  <td className="px-4 py-3.5 text-right align-top">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatNumber(metric.conversions24h)}
                    </span>
                    {metric.conversionsTotal > 0 ? (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatNumber(metric.conversionsTotal)} all time
                      </p>
                    ) : null}
                  </td>

                  <td className="px-4 py-3.5 align-top">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                        state.tone,
                      )}
                    >
                      {state.label}
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {metric.lastConversionAt
                        ? `Last conversion ${formatDate(metric.lastConversionAt)}`
                        : state.hint}
                    </p>
                  </td>

                  <td className="px-4 py-3.5 align-top">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={routes.experiments.detail(metric.experimentId)}>
                          View
                          <span className="sr-only"> results for {metric.name}</span>
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={routes.metrics.detail(metric.experimentId)}>
                          Edit
                          <span className="sr-only"> the goal for {metric.name}</span>
                        </Link>
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`More actions for ${metric.name}`}
                          >
                            <MoreVertical aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setPendingDelete([metric])}
                          >
                            <Trash2 aria-hidden />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DeleteMetricsDialog
        metrics={pendingDelete ?? []}
        open={pendingDelete !== null}
        onOpenChange={(open) => setPendingDelete(open ? pendingDelete : null)}
        action={deleteAction}
        onDeleted={() => setSelected([])}
      />
    </>
  );
}

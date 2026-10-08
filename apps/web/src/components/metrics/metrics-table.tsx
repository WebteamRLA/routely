"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreVertical, Trash2 } from "lucide-react";

import { DeleteMetricsDialog } from "@/components/metrics/delete-metrics-dialog";
import { Badge } from "@/components/ui/badge";
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

const STATE: Record<
  MetricState,
  { label: string; hint: string; variant: "success" | "warning" | "secondary" }
> = {
  collecting: { label: "Collecting", hint: "Recording conversions", variant: "success" },
  waiting: { label: "Waiting", hint: "Waiting for first conversion", variant: "warning" },
  paused: { label: "Paused", hint: "Its experiment is paused", variant: "secondary" },
  draft: { label: "Not live", hint: "Its experiment hasn't launched", variant: "secondary" },
  archived: { label: "Archived", hint: "Its experiment is archived", variant: "secondary" },
};

function typeLabel(metric: Metric): string {
  return metric.matchType === "PREFIX" ? "Pageview · Prefix" : "Pageview · Exact";
}

const TH = "px-3 py-2.5 whitespace-nowrap first:pl-5 last:pr-5 table-head";
const TD = "px-3 py-3 align-middle first:pl-5 last:pr-5";

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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-brand-tint px-5 py-2.5">
          <p className="text-[13.5px] font-bold">
            <span className="tabular-nums">{visibleSelected.length}</span> selected
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button
              variant="destructive-outline"
              size="sm"
              onClick={() => setPendingDelete(visibleSelected.map((id) => byId.get(id)!))}
            >
              Delete selected
            </Button>
          </div>
        </div>
      ) : null}

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[60rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-divider bg-subtle">
              <th scope="col" className={cn(TH, "w-10")}>
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
              <th scope="col" className={TH}>
                Metric
              </th>
              <th scope="col" className={TH}>
                Type
              </th>
              <th scope="col" className={TH}>
                Goal URL
              </th>
              <th scope="col" className={TH}>
                Last received
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                24h
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                All time
              </th>
              <th scope="col" className={TH}>
                Status
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                <span className="sr-only">Actions</span>
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
                  className="border-b border-divider text-[13.5px] transition-colors last:border-0 hover:bg-subtle data-[selected]:bg-brand-tint"
                >
                  <td className={TD}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => toggle(metric.experimentId, checked === true)}
                      aria-label={`Select ${metric.name}`}
                    />
                  </td>

                  <td className={TD}>
                    <Link
                      href={routes.metrics.detail(metric.experimentId)}
                      className="block max-w-[16rem] truncate font-extrabold hover:text-primary"
                    >
                      {metric.name}
                    </Link>
                    <p className="max-w-[16rem] truncate text-xs text-ink-3">
                      {metric.experimentName} · {metric.websiteName}
                    </p>
                  </td>

                  <td className={cn(TD, "whitespace-nowrap text-ink-2")}>{typeLabel(metric)}</td>

                  <td className={TD}>
                    <p
                      className="max-w-[14rem] truncate font-mono text-[12.5px]"
                      title={metric.url}
                    >
                      {metric.url}
                    </p>
                  </td>

                  <td className={cn(TD, "font-semibold whitespace-nowrap")}>
                    {metric.lastConversionAt ? (
                      formatDate(metric.lastConversionAt)
                    ) : (
                      <span className="text-warning-text">Never</span>
                    )}
                  </td>

                  <td className={cn(TD, "text-right font-bold tabular-nums")}>
                    {formatNumber(metric.conversions24h)}
                  </td>

                  <td className={cn(TD, "text-right text-ink-2 tabular-nums")}>
                    {formatNumber(metric.conversionsTotal)}
                  </td>

                  <td className={TD}>
                    <Badge variant={state.variant}>{state.label}</Badge>
                    <p className="mt-1 text-xs text-ink-3">{state.hint}</p>
                  </td>

                  <td className={TD}>
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={routes.metrics.detail(metric.experimentId)}
                        className="px-1 text-[12.5px] font-extrabold whitespace-nowrap text-primary hover:text-brand-hover"
                      >
                        Edit goal
                        <span className="sr-only"> for {metric.name}</span>
                      </Link>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`More actions for ${metric.name}`}
                          >
                            <MoreVertical aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={routes.experiments.detail(metric.experimentId)}>
                              View results
                            </Link>
                          </DropdownMenuItem>
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

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { MetricModal } from "@/components/metrics/metric-modal";
import { CardTitle, ConfirmModal, Section } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { fAgo, fN, minutesSince } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { MetricRow } from "@/lib/view-models";
import { deleteMetricAction } from "@/server/actions/metric.actions";

const COLS =
  "grid grid-cols-[minmax(140px,1.2fr)_110px_minmax(120px,1fr)_110px_70px_60px_150px] gap-3";

/**
 * "Metrics & custom events" (DESIGN.md 2.7 Metrics): every metric with its real last-received
 * time and 24-hour count (from `MetricHit`), how many experiments use it, and its setup action.
 */
export function MetricsEventsTable({
  projectId,
  metrics,
  now,
}: {
  projectId: string;
  metrics: MetricRow[];
  /** The server's render time (ISO), so "Last received" hydrates to the same text. */
  now: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<MetricRow | null>(null);
  const [pending, startDelete] = useTransition();

  function confirmDelete() {
    const metric = deleting;
    if (!metric) return;
    startDelete(async () => {
      const result = await deleteMetricAction({ projectId, metricId: metric.id });
      setDeleting(null);
      toast(result.status === "error" ? result.message : (result.message ?? "Metric deleted"));
      if (result.status === "success") router.refresh();
    });
  }

  return (
    <Section clip>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-divider px-5 py-[18px]">
        <div>
          <CardTitle size={15.5}>Metrics &amp; custom events</CardTitle>
          <p className="mt-1 max-w-[520px] text-[13px] text-ink-3">
            A metric is something you want to measure. Any metric can become an experiment’s
            conversion goal. page_view is tracked automatically.
          </p>
        </div>
        <Button size="sm" className="h-9 font-extrabold" onClick={() => setCreating(true)}>
          + New metric
        </Button>
      </div>

      <div className="relative overflow-x-auto">
        <div className="min-w-[780px]" role="table" aria-label="Metrics">
          <div
            role="row"
            className={`${COLS} table-head border-b border-divider bg-subtle px-5 py-2.5`}
          >
            <div role="columnheader">Metric</div>
            <div role="columnheader">Type</div>
            <div role="columnheader">Event name</div>
            <div role="columnheader">Last received</div>
            <div role="columnheader" className="text-right">
              24h
            </div>
            <div role="columnheader" className="text-right">
              Used
            </div>
            <div role="columnheader" aria-label="Actions" />
          </div>
          {metrics.map((m) => {
            const never = !m.lastReceivedAt;
            return (
              <div
                role="row"
                key={m.id}
                className={`${COLS} items-center border-b border-divider px-5 py-3 text-[13.5px] last:border-0`}
              >
                <div
                  role="cell"
                  className="min-w-0 truncate font-extrabold"
                  title={m.url ?? undefined}
                >
                  {m.name}
                </div>
                <div role="cell" className="text-ink-2">
                  {m.system ? "Page view" : m.kind === "page" ? "Page visit" : "Custom event"}
                </div>
                <div role="cell" className="min-w-0 truncate font-mono text-[12.5px]">
                  {m.key}
                </div>
                <div
                  role="cell"
                  className={never ? "font-semibold text-[#94600A]" : "font-semibold text-ink-3"}
                >
                  {never ? "Never" : fAgo(minutesSince(m.lastReceivedAt!, new Date(now)))}
                </div>
                <div role="cell" className="text-right tabular-nums">
                  {fN(m.count24h)}
                </div>
                <div role="cell" className="text-right tabular-nums">
                  {m.usedIn}
                </div>
                <div role="cell" className="flex items-center justify-end gap-3">
                  {m.system || m.kind === "page" ? (
                    <span className="text-xs text-ink-3">Automatic</span>
                  ) : (
                    <Link
                      href={routes.project(projectId).metrics("gtm", { metric: m.id })}
                      className="text-[12.5px] font-extrabold text-brand no-underline hover:underline"
                    >
                      GTM setup
                    </Link>
                  )}
                  {m.system ? null : (
                    <button
                      type="button"
                      onClick={() => setDeleting(m)}
                      aria-label={`Delete ${m.name}`}
                      className="cursor-pointer border-0 bg-transparent text-[12.5px] font-bold text-danger-text hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <MetricModal open={creating} onClose={() => setCreating(false)} projectId={projectId} />
      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this metric?"
        body={
          deleting
            ? `“${deleting.name}” will be removed from this project${
                deleting.usedIn > 0
                  ? " and from the secondary goals of experiments that use it"
                  : ""
              }. This can’t be undone.`
            : null
        }
        confirmLabel={pending ? "Deleting…" : "Delete"}
        onConfirm={confirmDelete}
        pending={pending}
      />
    </Section>
  );
}

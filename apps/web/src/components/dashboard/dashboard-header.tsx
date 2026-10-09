"use client";

import Link from "next/link";
import { toast } from "sonner";

import { downloadCsv, exportFileName, overviewCsv, type ExportRow } from "./export-csv";
import { useOpenInstall } from "./install-context";
import type { DashboardView } from "./model";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const BTN = "h-9 gap-[7px] px-3.5 text-[13px]";

/**
 * "Overview" with Export and the two create buttons, then PROJECT {name}, the tracking pill
 * (opens the install modal) and the summary line, over a hairline (v2 `isDash` header).
 */
export function DashboardHeader({
  projectId,
  projectName,
  tracking,
  sub,
  exportRows,
}: {
  projectId: string;
  projectName: string;
  tracking: DashboardView["tracking"];
  sub: string;
  exportRows: ExportRow[];
}) {
  const openInstall = useOpenInstall();
  const p = routes.project(projectId);

  function onExport() {
    try {
      downloadCsv(exportFileName(projectName), overviewCsv(exportRows));
      toast(
        `Overview exported as CSV · ${exportRows.length} experiment${exportRows.length === 1 ? "" : "s"}`,
      );
    } catch {
      toast.error("Couldn’t export the overview. Try again.");
    }
  }

  const t = tracking.live
    ? { color: "#0B6B47", bg: "#F4FBF7", border: "#C3E7D6", dot: "#13A06B" }
    : { color: "#7A4E07", bg: "#FDF5E6", border: "#F1DDB6", dot: "#D9930F" };

  return (
    <div className="flex flex-col gap-3 border-b border-border pb-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-heading text-[clamp(24px,2.4vw,28px)] font-bold tracking-[-0.025em]">
          Overview
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className={BTN} onClick={onExport}>
            <span aria-hidden className="text-[13px]">
              ↓
            </span>
            Export
          </Button>
          <Button asChild variant="outline" className={BTN}>
            <Link href={p.newExperiment("redirect")}>+ Split URL test</Link>
          </Button>
          <Button asChild className={BTN}>
            <Link href={p.newExperiment("ab")}>+ A/B test</Link>
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-extrabold tracking-[0.1em] text-faint">PROJECT</span>
          <span className="truncate text-[13px] font-bold">{projectName}</span>
        </div>
        <button
          type="button"
          onClick={openInstall}
          aria-label={`${tracking.label} · ${tracking.sub} — installation & tracking`}
          className="inline-flex h-[30px] max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-[20px] border px-3 text-[12.5px] font-bold outline-none focus-visible:ring-3 focus-visible:ring-primary/30"
          style={{ color: t.color, background: t.bg, borderColor: t.border }}
        >
          <span
            aria-hidden
            className={cn(
              "size-[7px] shrink-0 rounded-full",
              tracking.live && "animate-[rl-pulse_1.8s_infinite]",
            )}
            style={{ background: t.dot }}
          />
          <span className="whitespace-nowrap">{tracking.label}</span>
          <span aria-hidden className="h-3.5 w-px shrink-0" style={{ background: t.border }} />
          <span className="truncate font-semibold">{tracking.sub}</span>
        </button>
        <span className="text-[12.5px] text-ink-3">{sub}</span>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";

import { StatusPill } from "@/components/rl";
import { Button } from "@/components/ui/button";
import type { DisplayStatusKey, ExperimentStatusKey } from "@/lib/domain";
import { TYPE_LABEL } from "@/lib/verdict";
import type { ExperimentKind } from "@/lib/domain";

/**
 * Back link, status/type/timing, name and URL, and the actions for the status
 * (prototype L1344–1368):
 * draft: Duplicate · Delete · Continue setup → ; running: Preview · Duplicate · Pause · End;
 * paused: Preview · Duplicate · Resume · End; completed: Preview · Duplicate.
 */
export function DetailHeader({
  backHref,
  status,
  displayStatus,
  type,
  timing,
  name,
  url,
  pending,
  continueHref,
  onPreview,
  onDuplicate,
  onPause,
  onResume,
  onEnd,
  onDelete,
}: {
  backHref: string;
  status: ExperimentStatusKey;
  displayStatus: DisplayStatusKey;
  type: ExperimentKind;
  timing: string;
  name: string;
  url: string;
  pending: boolean;
  continueHref: string;
  onPreview: () => void;
  onDuplicate: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onDelete: () => void;
}) {
  const draft = status === "draft";
  return (
    <div className="flex flex-col gap-2.5">
      <Link
        href={backHref}
        className="w-fit text-[13px] font-bold text-ink-3 no-underline hover:text-ink"
      >
        ← Experiments
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3.5">
        <div className="min-w-0 flex-[1_1_420px]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={displayStatus} />
            <span className="rounded-md border border-input px-[7px] py-0.5 text-[12px] font-bold text-ink-2">
              {TYPE_LABEL[type]}
            </span>
            <span className="text-[12.5px] text-ink-3">{timing}</span>
          </div>
          <h1 className="mt-2.5 mb-1 font-heading text-[clamp(22px,2.4vw,26px)] font-bold tracking-[-0.02em] text-pretty">
            {name}
          </h1>
          <div className="font-mono text-[12.5px] break-all text-ink-3">{url}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!draft ? (
            <Button variant="outline" className="text-[13px]" onClick={onPreview}>
              Preview
            </Button>
          ) : null}
          <Button
            variant="outline"
            className="text-[13px]"
            onClick={onDuplicate}
            disabled={pending}
          >
            Duplicate
          </Button>
          {status === "running" ? (
            <Button variant="outline" className="text-[13px]" onClick={onPause} disabled={pending}>
              Pause
            </Button>
          ) : null}
          {status === "paused" ? (
            <Button variant="success" className="text-[13px]" onClick={onResume} disabled={pending}>
              Resume
            </Button>
          ) : null}
          {status === "running" || status === "paused" ? (
            <Button variant="dark" className="text-[13px]" onClick={onEnd} disabled={pending}>
              End experiment
            </Button>
          ) : null}
          {draft ? (
            <>
              <Button
                variant="outline"
                className="border-danger-border text-[13px] text-danger-text hover:bg-danger-bg"
                onClick={onDelete}
                disabled={pending}
              >
                Delete
              </Button>
              <Button asChild className="px-4 text-[13px]">
                <Link href={continueHref}>Continue setup →</Link>
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

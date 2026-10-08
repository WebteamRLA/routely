"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Banner, CardTitle, ConfirmModal, Section, StatTile } from "@/components/rl";
import { Button } from "@/components/ui/button";
import type { CdnOverview } from "@/lib/view-models";
import { purgeCdnAction } from "@/server/actions/project.actions";

/**
 * Integrations → CDN delivery (DESIGN.md 2.7 CDN). A SERVICE SEAM: no CDN is connected, so the
 * statistics are placeholders and labelled as such; "Purge" records when it was pressed and
 * purges nothing. The caching rules are what this app's own headers do.
 */
export function CdnPanel({
  projectId,
  overview,
  timezone,
}: {
  projectId: string;
  overview: CdnOverview;
  timezone: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [purging, start] = useTransition();

  function purge() {
    setConfirm(false);
    start(async () => {
      const result = await purgeCdnAction(projectId);
      toast(result.status === "success" ? (result.message ?? "Purge recorded") : result.message);
      router.refresh();
    });
  }

  const lastPurge = overview.lastPurgedAt
    ? new Date(overview.lastPurgedAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone,
      })
    : "Never";

  return (
    <Section padded className="gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle size={15.5}>CDN campaign delivery</CardTitle>
          <p className="mt-1 max-w-[540px] text-[13px] text-ink-3">
            Static assets are served from the nearest edge location. Visitor assignment stays
            personalised and is never cached, so one visitor’s variant is never shown to another.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-[20px] bg-divider px-2.5 py-1 text-xs font-extrabold text-ink-2">
          <span aria-hidden className="size-[7px] rounded-full bg-[#9AA3B5]" />
          Not connected
        </span>
      </div>

      <Banner tone="warning">
        Preview data — CDN delivery isn’t connected. The Routely script is served from{" "}
        <span className="font-mono text-[12.5px] break-all">{overview.sdkUrl}</span>; the figures
        below are placeholders until a CDN is attached.
      </Banner>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-3">
        {overview.stats.map((s) => (
          <StatTile
            key={s.label}
            label={
              <>
                {s.label} <span className="font-semibold text-faint">· placeholder</span>
              </>
            }
            value={s.value}
          />
        ))}
        <div className="rounded-lg border border-divider px-3.5 py-3">
          <div className="text-xs font-bold text-ink-3">Last purge</div>
          <div className="mt-2 font-heading text-[17px] font-semibold">
            {purging ? "Purging…" : lastPurge}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
        <div className="overflow-hidden rounded-lg border border-divider">
          <div className="bg-[#F5F6F9] px-3.5 py-2.5 text-[13px] font-extrabold">
            Cached at the edge
          </div>
          {overview.staticRules.map((r) => (
            <div
              key={r.asset}
              className="flex justify-between gap-2.5 border-t border-divider px-3.5 py-[9px] text-[13px]"
            >
              <span>{r.asset}</span>
              <span className="text-right font-mono text-xs text-ink-3">{r.ttl}</span>
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-divider">
          <div className="bg-navy px-3.5 py-2.5 text-[13px] font-extrabold text-white">
            Never cached · personalised
          </div>
          {overview.dynamicRules.map((r) => (
            <div
              key={r}
              className="flex justify-between gap-2.5 border-t border-divider px-3.5 py-[9px] text-[13px]"
            >
              <span>{r}</span>
              <span className="font-mono text-xs text-ink-3">no-store</span>
            </div>
          ))}
        </div>
      </div>

      <Button
        variant="outline"
        className="self-start"
        onClick={() => setConfirm(true)}
        disabled={purging}
      >
        {purging ? "Purging…" : "Purge static cache"}
      </Button>

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Purge static cache?"
        body="Edge locations would re-fetch scripts, variant assets and campaign pages. No CDN is connected yet, so Routely only records when you purged. Visitor assignments are not affected."
        confirmLabel="Purge cache"
        tone="dark"
        onConfirm={purge}
      />
    </Section>
  );
}

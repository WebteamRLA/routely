"use client";

import Link from "next/link";

import { CARD, CARD_TITLE } from "./conversions-card";
import { useOpenInstall } from "./install-context";
import type { FeedItem, IntegrationItem } from "./model";

/**
 * "Team activity" (v2 rail): the newest rows of the project's experiment activity logs, each
 * opening its experiment (a draft opens the wizard), and "+ Invite teammate" → Settings → Team.
 */
export function ActivityCard({
  feed,
  allHref,
  teamHref,
}: {
  feed: FeedItem[];
  allHref: string;
  teamHref: string;
}) {
  return (
    <section className={`${CARD} gap-3.5`}>
      <div className="flex items-center justify-between gap-2.5">
        <h2 className={CARD_TITLE}>Team activity</h2>
        <Link href={allHref} className="text-[12.5px] font-bold">
          All experiments →
        </Link>
      </div>
      {feed.length ? (
        feed.map((a) => (
          <Link
            key={a.id}
            href={a.href}
            className="flex min-w-0 items-start gap-2.5 text-foreground no-underline hover:text-foreground hover:no-underline"
          >
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white"
              style={{ background: a.avBg }}
            >
              {a.initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-[1.4]">
                <b>{a.who}</b> <span className="text-ink-2">{a.text}</span>
              </span>
              <span className="block truncate text-xs text-ink-3">
                {a.experiment} · {a.when}
              </span>
            </span>
          </Link>
        ))
      ) : (
        <div className="text-[13px] text-ink-3">No activity yet in this project.</div>
      )}
      <div className="border-t border-divider pt-3">
        <Link
          href={teamHref}
          className="inline-flex h-8 items-center rounded-md border border-input bg-card px-3 text-[12.5px] font-bold text-foreground no-underline hover:bg-muted hover:text-foreground hover:no-underline"
        >
          + Invite teammate
        </Link>
      </div>
    </section>
  );
}

/**
 * "Recommended integrations" (v2 rail). Statuses are real: the snippet's from install detection,
 * Sheets' only when this project has a connected spreadsheet. The CDN panel is a service seam
 * with placeholder figures, so it carries no status.
 */
export function IntegrationsCard({
  items,
  allHref,
}: {
  items: IntegrationItem[];
  allHref: string;
}) {
  const openInstall = useOpenInstall();
  const row =
    "-mx-1.5 flex min-w-0 cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-1.5 py-2.5 text-left text-foreground no-underline outline-none hover:bg-muted hover:text-foreground hover:no-underline focus-visible:ring-3 focus-visible:ring-primary/30";
  return (
    <section className={`${CARD} gap-1`}>
      <h2 className={`${CARD_TITLE} mb-2`}>Recommended integrations</h2>
      {items.map((i) => {
        const body = (
          <>
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-md font-mono text-[11px] font-bold"
              style={{ background: i.bg, color: i.fg }}
            >
              {i.mark}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold">{i.name}</span>
              <span className="block truncate text-xs text-ink-3">{i.desc}</span>
            </span>
            {i.status ? (
              <span
                className="text-[11.5px] font-extrabold whitespace-nowrap"
                style={{ color: i.status.color }}
              >
                {i.status.text}
              </span>
            ) : null}
            <span aria-hidden className="text-sm text-faint">
              ›
            </span>
          </>
        );
        return i.href ? (
          <Link key={i.key} href={i.href} className={row}>
            {body}
          </Link>
        ) : (
          <button key={i.key} type="button" onClick={openInstall} className={row}>
            {body}
          </button>
        );
      })}
      <Link href={allHref} className="mt-2 text-[12.5px] font-bold">
        All integrations →
      </Link>
    </section>
  );
}

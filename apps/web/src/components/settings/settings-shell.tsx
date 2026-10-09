import type { ReactNode } from "react";

import { PageTitle, Shimmer, SideTabs } from "@/components/rl";
import { routes } from "@/lib/routes";

/** Every section the design's Settings page lists, in its order. */
export type SettingsSection = "project" | "install" | "metrics" | "gtm" | "sheets" | "cdn" | "team";

/**
 * The design's Settings page (prototype `isSettings`): one "Settings" heading and seven side tabs.
 * The app keeps its routes — Metrics & goals (`/metrics`), Integrations (`/integrations`) and
 * Settings (`/settings/[tab]`) — so the sidebar can highlight each; every one of those pages
 * renders inside this shell, and each tab links to its route.
 */
export function SettingsShell({
  projectId,
  projectName,
  active,
  children,
}: {
  projectId: string;
  projectName: string;
  active: SettingsSection;
  children: ReactNode;
}) {
  const r = routes.project(projectId);
  const tabs: { key: SettingsSection; label: string; href: string }[] = [
    { key: "project", label: "Project", href: r.settings("project") },
    { key: "install", label: "Installation & tracking", href: r.settings("install") },
    { key: "metrics", label: "Metrics & events", href: r.metrics() },
    { key: "gtm", label: "Google Tag Manager", href: r.metrics("gtm") },
    { key: "sheets", label: "Google Sheets", href: r.integrations() },
    { key: "cdn", label: "CDN delivery", href: r.integrations("cdn") },
    { key: "team", label: "Team", href: r.settings("team") },
  ];
  return (
    <div className="mx-auto flex w-full max-w-[1200px] animate-rl-in flex-col gap-[18px]">
      <PageTitle title="Settings" sub={`Project, tracking and integrations for ${projectName}.`} />
      {/* The design wraps: tabs beside the content when both fit (220 + 20 + 560px), above it
          otherwise. Below 900px the tabs become one full-width horizontal scroller. */}
      <div className="flex flex-wrap items-start gap-5">
        <SideTabs
          className="max-w-full min-w-0 flex-[1_1_100%] nav:flex-[0_1_220px]"
          active={active}
          tabs={tabs}
        />
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

/** The shell's loading state: heading and seven tab placeholders around a section skeleton. */
export function SettingsShellSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[18px]" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Shimmer className="h-7 w-40" />
        <Shimmer className="h-4 w-72" />
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex max-w-full min-w-0 flex-[1_1_100%] gap-0.5 overflow-hidden nav:flex-[0_1_220px] nav:flex-col">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Shimmer key={i} className="h-[38px] w-32 shrink-0 nav:w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

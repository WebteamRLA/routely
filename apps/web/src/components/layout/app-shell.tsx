import type { ReactNode } from "react";

import { Brand } from "@/components/layout/brand";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NewExperimentButton } from "@/components/layout/new-experiment-button";
import { SidebarAccount } from "@/components/layout/sidebar-account";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { WebsiteSwitcher, type SwitcherWebsite } from "@/components/layout/website-switcher";
import type { SessionUser } from "@/server/auth/session";

/**
 * Dashboard chrome, as the design draws it: a 240px navy sidebar holding the wordmark, the
 * website menu, the nav, a "+ New experiment" button and the account menu. Below 900px the
 * sidebar is replaced by a navy top bar whose Menu button opens the same contents in a drawer.
 *
 * `fixed inset-0`, and only `<main>` scrolls: the shell takes itself out of the document's
 * flow so `<body>` has nothing to scroll and a second scrollbar can never appear. The public
 * share page and the auth screens scroll the document normally and never mount this.
 */
export function AppShell({
  user,
  websites,
  children,
}: {
  user: SessionUser;
  websites: SwitcherWebsite[];
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 flex overflow-hidden bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col gap-4 bg-navy px-3.5 pt-5 pb-3.5 text-white nav:flex">
        <div className="px-2">
          <Brand tone="light" />
        </div>
        <WebsiteSwitcher websites={websites} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <NewExperimentButton />
        <SidebarAccount user={user} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-40 flex h-14 shrink-0 items-center justify-between gap-3 bg-navy px-4 text-white nav:hidden">
          <Brand tone="light" className="text-[17px]" />
          <MobileNav user={user} websites={websites} />
        </header>

        {/* The design's page padding: 28px on top, a side gutter that grows from 16px to 40px
         * with the viewport, and room at the foot for the toast. */}
        <main className="min-h-0 flex-1 overflow-y-auto px-[clamp(16px,3.2vw,40px)] pt-7 pb-[110px]">
          <div className="mx-auto flex w-full max-w-[1680px] animate-rl-in flex-col gap-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

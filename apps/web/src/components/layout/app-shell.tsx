"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { Brand } from "@/components/layout/brand";
import { CloseIcon, MenuIcon } from "@/components/layout/nav-icons";
import { SidebarAccount } from "@/components/layout/sidebar-account";
import { PRIMARY_NAV, WORKSPACE_NAV } from "@/components/layout/nav-items";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/server/auth/session";

const iconButton = cn(
  "inline-flex cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-[#374151]",
  "hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)]",
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]",
);

/**
 * Dashboard chrome: a docked 240px sidebar from 1200px up; below that, the same sidebar as an
 * off-canvas drawer opened from a slim top bar. Pages render into `children`; only `<main>`
 * scrolls.
 *
 * One `<aside>` serves both layouts rather than a sidebar plus a separate drawer component, so
 * the two can never drift apart — the breakpoint only changes how it is positioned. While the
 * drawer is closed it is also `invisible`, which keeps its links out of the tab order and away
 * from screen readers instead of merely off-screen; `visibility` switches at the *end* of the
 * slide-out transition, so closing still animates.
 *
 * There is no top bar on desktop: identity lives at the foot of the sidebar and every page has
 * its own header, so a bar there would be an empty strip. Below 1200px it is not a leftover —
 * there is no docked sidebar, so the menu button and wordmark have nowhere else to live.
 */
export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer after a navigation. Done by watching the path rather than by an onClick
  // on each link, so a navigation from anywhere — a link in the page, Back — closes it too.
  // State adjusted during render (React's documented alternative to an effect for this).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  // `fixed inset-0` rather than a height: the shell manages its own scrolling in `<main>`, so
  // it must not also contribute height to the document. Taking it out of flow leaves `<body>`
  // with nothing to scroll, which is the only way to guarantee a second scrollbar cannot appear
  // — a height-based shell is always one rounding difference (a horizontal scrollbar, browser
  // chrome, an injected element) away from overflowing by a few pixels. The design scrolls the
  // document with a sticky sidebar instead; the result on screen is the same.
  //
  // Scoped to the dashboard: the public share page and the auth screens scroll the document
  // normally and never mount this component.
  return (
    <div
      className={cn(
        "fixed inset-0 flex overflow-hidden bg-white",
        "text-sm leading-[1.45] text-[#111827] antialiased",
      )}
    >
      <aside
        aria-label="Main navigation"
        className={cn(
          "flex w-[240px] shrink-0 flex-col gap-5 border-r border-[#EEF0F3] bg-[#FAFBFC] px-3 pt-5 pb-2.5",
          "max-[1200px]:fixed max-[1200px]:inset-y-0 max-[1200px]:left-0 max-[1200px]:z-[60]",
          "max-[1200px]:w-[288px] max-[1200px]:max-w-[86vw] max-[1200px]:shadow-[0_.5rem_2rem_#11182724]",
          "max-[1200px]:transition-[transform,visibility] max-[1200px]:duration-[220ms] max-[1200px]:ease-[ease]",
          "motion-reduce:transition-none",
          drawerOpen ? "translate-x-0" : "max-[1200px]:invisible max-[1200px]:-translate-x-[104%]",
        )}
      >
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-1.5">
          <Brand />
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className={cn(iconButton, "h-9 w-10 min-[1200px]:hidden")}
          >
            <CloseIcon />
          </button>
        </div>

        <SidebarNav items={PRIMARY_NAV} label="Primary" />

        {/* Pushes the workspace group and account block to the foot. */}
        <div className="min-h-0 flex-1" />

        <SidebarNav items={WORKSPACE_NAV} label="Workspace" />

        <SidebarAccount user={user} />
      </aside>

      {/* The scrim is a button so a tap anywhere outside the drawer closes it, but it is not a
       * tab stop: Escape and the drawer's own close button are the keyboard paths. */}
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-[55] border-0 bg-[rgba(17,24,39,.28)] p-0 min-[1200px]:hidden"
        />
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-50 flex h-14 shrink-0 items-center gap-2.5 border-b border-[#EEF0F3] bg-white px-3 min-[1200px]:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className={cn(iconButton, "size-11")}
          >
            <MenuIcon />
          </button>
          <Brand />
        </header>

        {/*
         * Content fills the width the sidebar leaves it — a reading-width cap is right for prose
         * and wrong for a data table; `PageHeader` caps its own description instead.
         *
         * The flex column with the design's 24px gap is on an inner wrapper, not on `<main>`:
         * `<main>` has a fixed height (it is the scroll container), and flex children of a
         * fixed-height column shrink to fit it — anything with `overflow: hidden`, such as a
         * card, would be squashed instead of scrolled.
         */}
        <main className="min-h-0 flex-1 overflow-y-auto bg-white px-8 pt-6 pb-7 max-[1321px]:px-6 max-[641px]:px-4 max-[641px]:pt-5 max-[641px]:pb-8">
          <div className="flex w-full flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

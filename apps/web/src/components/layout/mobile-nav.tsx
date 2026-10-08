"use client";

import { useState } from "react";

import { NewExperimentButton } from "@/components/layout/new-experiment-button";
import { SidebarAccount } from "@/components/layout/sidebar-account";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { WebsiteSwitcher, type SwitcherWebsite } from "@/components/layout/website-switcher";
import type { SessionUser } from "@/server/auth/session";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * The sidebar's contents in a left drawer, below the 900px breakpoint: 300px wide or 86% of
 * the viewport, whichever is smaller, on the same navy.
 */
export function MobileNav({ user, websites }: { user: SessionUser; websites: SwitcherWebsite[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="h-9 cursor-pointer rounded-md border border-white/20 bg-transparent px-3.5 text-[13px] font-bold text-white outline-none focus-visible:ring-3 focus-visible:ring-primary/40"
        >
          Menu
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="flex w-[min(300px,86vw)] flex-col gap-4 border-0 bg-navy px-3.5 pt-5 pb-3.5 text-white sm:max-w-none"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Main navigation</SheetDescription>
        <WebsiteSwitcher websites={websites} onNavigate={close} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav onNavigate={close} />
        </div>
        <NewExperimentButton onNavigate={close} />
        <SidebarAccount user={user} />
      </SheetContent>
    </Sheet>
  );
}

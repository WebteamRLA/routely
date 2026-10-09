"use client";

import { BrandMark } from "@/components/layout/brand";
import type { NavItem } from "@/components/layout/nav-items";
import { NavList } from "@/components/layout/nav-list";
import { NewExperimentButton } from "@/components/layout/new-experiment-button";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { ProjectSwitcher } from "@/components/layout/project-switcher";
import type { ShellUser } from "@/components/layout/types";

/**
 * The desktop sidebar (≥ 900px): 240px, sticky, navy — brand, project switcher, the grouped nav
 * (scrolls on short screens), "+ New experiment" and the profile menu (design v2 `aside`). Line
 * height is the prototype's `normal` rather than the app's 1.5, so the rows measure as designed.
 */
export function Sidebar({ user, nav }: { user: ShellUser; nav: NavItem[] }) {
  return (
    <aside className="sticky top-0 z-50 hidden h-screen w-60 min-w-0 shrink-0 flex-col gap-4 bg-navy px-3.5 pt-5 pb-3.5 text-white nav:flex">
      <div className="flex items-center gap-2.5 px-2">
        <BrandMark />
        <div className="font-heading text-[19px] font-semibold tracking-[-0.01em]">Routely</div>
      </div>
      <ProjectSwitcher />
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <NavList items={nav} />
      </nav>
      <NewExperimentButton />
      <ProfileMenu user={user} />
    </aside>
  );
}

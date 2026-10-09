"use client";

import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/layout/brand";
import type { NavItem } from "@/components/layout/nav-items";
import { NavList } from "@/components/layout/nav-list";
import { NewExperimentButton } from "@/components/layout/new-experiment-button";
import { displayName } from "@/components/layout/profile-menu";
import { useShell } from "@/components/layout/shell-context";
import type { ShellUser } from "@/components/layout/types";
import { Avatar, ProjectIcon } from "@/components/rl";
import { cn } from "@/lib/utils";

/**
 * Below 900px: the 56px navy top bar with "Menu", and the drawer it opens (design v2): PROJECTS
 * (✓ on the current one), "+ Create new project", the grouped nav — spaced by the drawer's own
 * 16px gap, as the prototype lays its items out directly in the drawer column — "+ New
 * experiment" and the user row with "Log out".
 */
export function MobileNav({ user, nav }: { user: ShellUser; nav: NavItem[] }) {
  const { projects, current, switchProject, openCreateProject, logout } = useShell();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const active = projects.filter((p) => !p.archived);

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between bg-navy px-4 text-white nav:hidden">
        <div className="flex min-w-0 items-center gap-[9px]">
          <BrandMark className="size-[22px]" />
          <div className="font-heading text-[17px] font-semibold">Routely</div>
          <div className="ml-1 min-w-0 truncate font-mono text-[11px] text-white/60">
            {current?.domain ?? "—"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="h-9 shrink-0 cursor-pointer rounded-md border border-white/20 bg-transparent px-3.5 text-[13px] font-bold text-white outline-none focus-visible:ring-3 focus-visible:ring-primary/40"
        >
          Menu
        </button>
      </header>

      {open ? (
        <div
          className="fixed inset-0 z-80 bg-[rgba(10,22,51,0.45)] nav:hidden"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col gap-4 overflow-y-auto bg-navy px-3.5 py-5 text-white outline-none"
          >
            <div className="flex items-center justify-between px-2">
              <span className="font-heading text-lg font-semibold">Routely</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={close}
                className="cursor-pointer border-0 bg-transparent text-[22px] text-white"
              >
                ×
              </button>
            </div>

            <div className="flex flex-col gap-1 border-b border-white/10 pb-3">
              <div className="px-2.5 pb-1 text-[10.5px] font-extrabold tracking-[0.12em] text-white/45">
                PROJECTS
              </div>
              {active.map((p) => {
                const cur = p.id === current?.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      close();
                      if (!cur) switchProject(p.id);
                    }}
                    className={cn(
                      "flex min-h-[46px] w-full cursor-pointer items-center gap-2.5 rounded-md border-0 px-2.5 py-1.5 text-left text-white",
                      cur ? "bg-white/9" : "bg-transparent",
                    )}
                  >
                    <ProjectIcon name={p.name} iconUrl={p.iconUrl} tone="white" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold">{p.name}</span>
                      <span className="block truncate font-mono text-[11px] text-white/60">
                        {p.domain}
                      </span>
                    </span>
                    <span className="font-black text-coral">{cur ? "✓" : ""}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  close();
                  openCreateProject();
                }}
                className="mt-1 h-10 cursor-pointer rounded-md border border-dashed border-white/25 bg-transparent text-[13.5px] font-bold text-[#C9D6FF]"
              >
                + Create new project
              </button>
            </div>

            <nav aria-label="Main" className="flex flex-col gap-4">
              <NavList items={nav} size="drawer" onNavigate={close} />
            </nav>

            <NewExperimentButton className="mt-auto h-11 rounded-md" onNavigate={close} />

            <div className="flex items-center gap-2.5 border-t border-white/10 px-2 pt-3">
              <Avatar name={displayName(user)} size={30} tone="coral" image={user.image} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold">{displayName(user)}</div>
                <div className="truncate text-xs text-white/60">{user.email}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  close();
                  logout();
                }}
                className="h-[34px] shrink-0 cursor-pointer rounded-md border border-white/25 bg-transparent px-3 text-[13px] font-bold text-white"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

"use client";

import { useCallback, useRef, useState } from "react";

import { useShell } from "@/components/layout/shell-context";
import { ProjectIcon, useDismiss } from "@/components/rl";
import { cn } from "@/lib/utils";

/**
 * The sidebar's project switcher (DESIGN.md §1.3): the current project's tile, name and domain;
 * the dropdown lists it with ✓, the other active projects, and "Create new project".
 */
export function ProjectSwitcher() {
  const { projects, current, switchProject, openCreateProject } = useShell();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  const others = projects.filter((p) => !p.archived && p.id !== current?.id);
  const name = current?.name ?? "No project yet";
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch project"
        aria-expanded={open}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-white/9 px-3 py-2.5 text-left text-white outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-primary/40",
          open ? "bg-white/12" : "bg-white/6",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white font-heading text-[13px] font-bold text-navy">
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold">{name}</span>
          <span className="block truncate font-mono text-[11px] text-white/62">
            {current?.domain ?? "—"}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-[10px] text-white/60">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-60 max-h-[calc(100vh-140px)] animate-[rl-in_.15s_ease] overflow-y-auto rounded-lg bg-white p-1.5 text-foreground shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
          {current ? (
            <>
              <MenuLabel first>CURRENT PROJECT</MenuLabel>
              <div className="flex items-center gap-2.5 rounded-md bg-brand-tint px-2.5 py-2">
                <ProjectIcon name={current.name} iconUrl={current.iconUrl} tone="navy" />
                <ProjectText name={current.name} domain={current.domain} strong />
                <span className="shrink-0 font-black text-brand">✓</span>
              </div>
            </>
          ) : null}
          {others.length ? (
            <>
              <MenuLabel first={!current}>OTHER PROJECTS</MenuLabel>
              {others.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    switchProject(p.id);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-foreground hover:bg-background"
                >
                  <ProjectIcon name={p.name} iconUrl={p.iconUrl} tone="light" />
                  <ProjectText name={p.name} domain={p.domain} />
                </button>
              ))}
            </>
          ) : null}
          <div className="mx-1 my-1.5 h-px bg-divider" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openCreateProject();
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-[9px] text-left text-[13.5px] font-extrabold text-brand hover:bg-brand-tint"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md border-[1.5px] border-dashed border-[#B9C6EE] text-base">
              +
            </span>
            Create new project
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MenuLabel({ children, first }: { children: string; first?: boolean }) {
  return (
    <div
      className={cn(
        "px-2.5 pb-1.5 text-[10.5px] font-extrabold tracking-[0.12em] text-ink-3",
        first ? "pt-2" : "pt-3",
      )}
    >
      {children}
    </div>
  );
}

function ProjectText({ name, domain, strong }: { name: string; domain: string; strong?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={cn("block truncate text-[13px]", strong ? "font-extrabold" : "font-bold")}>
        {name}
      </span>
      <span className="block truncate font-mono text-[11.5px] text-ink-3">{domain}</span>
    </span>
  );
}

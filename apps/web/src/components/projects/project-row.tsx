"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import type { ProjectRowData } from "@/components/projects/types";
import { MenuPanel, ProjectIcon, Tag, useDismiss } from "@/components/rl";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const BTN =
  "inline-flex h-[34px] cursor-pointer items-center rounded-md border border-input bg-card px-3 text-[13px] font-bold whitespace-nowrap text-foreground no-underline hover:bg-background hover:text-foreground hover:no-underline disabled:cursor-not-allowed disabled:opacity-60";

/** One Manage-projects row (DESIGN.md §2.6). Archived rows show Restore / Delete instead. */
export function ProjectRow({
  project,
  current,
  busy,
  onSwitch,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  project: ProjectRowData;
  current: boolean;
  busy: boolean;
  onSwitch: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const n = project.total;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-[18px] gap-y-2.5 border-b border-divider px-5 py-3.5",
        current ? "bg-[#F8FAFF]" : "bg-card",
      )}
    >
      <div className="flex min-w-0 flex-[1_1_260px] items-center gap-3">
        <ProjectIcon
          name={project.name}
          iconUrl={project.iconUrl}
          size={34}
          tone={current ? "navy" : "light"}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-extrabold">{project.name}</span>
            {current ? (
              <Tag tone="navy" className="tracking-[0.06em]">
                Current
              </Tag>
            ) : null}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-ink-3">{project.domain}</div>
        </div>
      </div>
      <div className="min-w-[140px] flex-[0_1_190px] text-[13px]">
        <div className="font-bold">
          {n
            ? `${project.running} running · ${n} experiment${n > 1 ? "s" : ""}`
            : "No experiments yet"}
        </div>
        <div className="mt-0.5 text-xs text-ink-3">{project.activity}</div>
      </div>
      <div className="relative ml-auto flex items-center gap-1.5">
        {project.archived ? (
          <>
            <button type="button" className={BTN} onClick={onRestore} disabled={busy}>
              Restore
            </button>
            <button
              type="button"
              className={cn(
                BTN,
                "border-danger-border text-danger-text hover:bg-danger-bg hover:text-danger-text",
              )}
              onClick={onDelete}
              disabled={busy}
            >
              Delete
            </button>
          </>
        ) : (
          <>
            {current ? (
              <Link href={routes.project(project.id).dashboard} className={BTN}>
                Open dashboard
              </Link>
            ) : (
              <button type="button" className={BTN} onClick={onSwitch}>
                Switch
              </button>
            )}
            <button type="button" className={BTN} onClick={onEdit}>
              Edit
            </button>
            <RowActions blocked={current} onArchive={onArchive} onDelete={onDelete} />
          </>
        )}
      </div>
    </div>
  );
}

/** The ⋯ menu: Archive / Delete, both disabled for the current project with a note. */
function RowActions({
  blocked,
  onArchive,
  onDelete,
}: {
  blocked: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  const item =
    "block w-full rounded-sm border-0 bg-transparent px-2.5 py-2 text-left text-[13.5px] font-semibold";
  return (
    <div ref={ref}>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="size-[34px] cursor-pointer rounded-md border border-transparent bg-transparent text-base font-extrabold text-ink-2 hover:bg-divider"
      >
        ⋯
      </button>
      {open ? (
        <MenuPanel className="top-10 w-[230px]">
          <button
            type="button"
            role="menuitem"
            aria-disabled={blocked}
            onClick={() => {
              if (blocked) return;
              close();
              onArchive();
            }}
            className={cn(
              item,
              "hover:bg-background",
              blocked ? "cursor-not-allowed text-[#A3ABBA]" : "cursor-pointer text-foreground",
            )}
          >
            Archive project
          </button>
          <button
            type="button"
            role="menuitem"
            aria-disabled={blocked}
            onClick={() => {
              if (blocked) return;
              close();
              onDelete();
            }}
            className={cn(
              item,
              "hover:bg-danger-bg",
              blocked ? "cursor-not-allowed text-[#A3ABBA]" : "cursor-pointer text-danger-text",
            )}
          >
            Delete project
          </button>
          {blocked ? (
            <div className="px-2.5 pt-1.5 pb-2 text-xs leading-[1.4] text-ink-3">
              Switch to another project first to archive or delete this one.
            </div>
          ) : null}
        </MenuPanel>
      ) : null}
    </div>
  );
}

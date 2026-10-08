"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useShell } from "@/components/layout/shell-context";
import { ArchiveProjectModal, DeleteProjectModal } from "@/components/projects/project-dialogs";
import { ProjectRow } from "@/components/projects/project-row";
import type { ProjectRowData } from "@/components/projects/types";
import { CardTitle, Section, TextInput } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { pauseExperimentAction } from "@/server/actions/experiment.actions";
import {
  archiveProjectAction,
  deleteProjectAction,
  restoreProjectAction,
} from "@/server/actions/project.actions";

/** Manage projects (DESIGN.md §2.6): search, active rows, archived section, create/edit. */
export function ProjectsManager({ projects }: { projects: ProjectRowData[] }) {
  const router = useRouter();
  const shell = useShell();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<ProjectRowData | null>(null);
  const [deleting, setDeleting] = useState<ProjectRowData | null>(null);
  const [pending, startTransition] = useTransition();

  const qq = q.trim().toLowerCase();
  const matches = (p: ProjectRowData) =>
    !qq || `${p.name} ${p.domains.join(" ")}`.toLowerCase().includes(qq);
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  const rows = active.filter(matches);
  const archRows = archived.filter(matches);
  const currentId = shell.current?.id ?? null;

  function edit(p: ProjectRowData) {
    const sp = shell.projects.find((x) => x.id === p.id);
    if (sp) shell.openEditProject(sp);
  }

  function confirmArchive() {
    const p = archiving;
    if (!p) return;
    startTransition(async () => {
      // archiveProjectAction only hides the project; pause its running experiments first so
      // visitors see the original pages, as the modal says.
      for (const experimentId of p.runningIds) {
        const paused = await pauseExperimentAction({ projectId: p.id, experimentId });
        if (paused.status === "error") {
          toast.error(paused.message);
          return;
        }
      }
      const result = await archiveProjectAction(p.id);
      if (result.status === "error") {
        toast.error(result.message);
        return;
      }
      setArchiving(null);
      router.refresh();
      toast(`${p.name} archived`);
    });
  }

  function restore(p: ProjectRowData) {
    startTransition(async () => {
      const result = await restoreProjectAction(p.id);
      if (result.status === "error") {
        toast.error(result.message);
        return;
      }
      router.refresh();
      toast(`${p.name} restored`);
    });
  }

  function confirmDelete() {
    const p = deleting;
    if (!p) return;
    startTransition(async () => {
      const result = await deleteProjectAction(p.id);
      if (result.status === "error") {
        toast.error(result.message);
        return;
      }
      setDeleting(null);
      router.refresh();
      toast(`${p.name} deleted`);
    });
  }

  const row = (p: ProjectRowData) => (
    <ProjectRow
      key={p.id}
      project={p}
      current={p.id === currentId}
      busy={pending}
      onSwitch={() => shell.switchProject(p.id)}
      onEdit={() => edit(p)}
      onArchive={() => setArchiving(p)}
      onRestore={() => restore(p)}
      onDelete={() => setDeleting(p)}
    />
  );

  return (
    <div className="mx-auto flex max-w-[1100px] animate-[rl-in_.2s_ease] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1.5 font-heading text-[clamp(22px,2.4vw,26px)] font-bold tracking-[-0.02em]">
            Manage projects
          </h1>
          <div className="text-ink-3">
            One project per website. Experiments, results, metrics and settings never mix between
            projects.
          </div>
        </div>
        <Button className="px-4" onClick={shell.openCreateProject}>
          New project
        </Button>
      </div>

      <Section as="div">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-5 py-3">
          <div className="flex items-baseline gap-2.5">
            <CardTitle size={15}>Active</CardTitle>
            <span className="text-[12.5px] text-ink-3">
              {qq ? `${rows.length} of ` : ""}
              {active.length} project{active.length === 1 ? "" : "s"}
            </span>
          </div>
          <TextInput
            inputSize="sm"
            aria-label="Search projects"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or domain"
            className="h-[34px] w-60 max-w-full text-[13.5px]"
          />
        </div>
        {qq && !rows.length ? (
          <div className="flex flex-col items-center gap-2 px-5 py-7 text-center">
            <div className="font-extrabold">No projects match “{q}”</div>
            <Button variant="outline" size="sm" onClick={() => setQ("")}>
              Clear search
            </Button>
          </div>
        ) : null}
        {!active.length && !qq ? (
          <div className="px-5 py-7 text-[13.5px] text-ink-3">
            No active projects. Create one to start testing.
          </div>
        ) : null}
        {rows.map(row)}
      </Section>

      {archived.length ? (
        <Section as="div">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between gap-2.5 border-0 bg-transparent px-5 py-3.5 text-left text-foreground"
          >
            <span className="font-heading text-[15px] font-bold">
              Archived{" "}
              <span className="font-sans text-[12.5px] font-semibold text-ink-3">
                · {archived.length}
              </span>
            </span>
            <span className="text-[12.5px] font-bold text-brand">
              {showArchived ? "Hide" : "Show"}
            </span>
          </button>
          {showArchived ? <div className="border-t border-border">{archRows.map(row)}</div> : null}
        </Section>
      ) : null}

      <ArchiveProjectModal
        project={archiving}
        pending={pending}
        onClose={() => setArchiving(null)}
        onConfirm={confirmArchive}
      />
      <DeleteProjectModal
        project={deleting}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

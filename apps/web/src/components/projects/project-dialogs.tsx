"use client";

import { useState } from "react";

import type { ProjectRowData } from "@/components/projects/types";
import { Modal, ModalActions, ModalTitle } from "@/components/rl";
import { Button } from "@/components/ui/button";

/** "Archive {name}?" — running experiments are paused first (DESIGN.md §3.1 archiveProject). */
export function ArchiveProjectModal({
  project,
  pending,
  onClose,
  onConfirm,
}: {
  project: ProjectRowData | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const r = project?.running ?? 0;
  return (
    <Modal open={!!project} onClose={onClose} label="Archive project" locked={pending}>
      <ModalTitle title={`Archive ${project?.name ?? ""}?`}>
        {r
          ? `${r} running experiment${r > 1 ? "s" : ""} will be paused and visitors will see the original pages.`
          : "No experiments are running in this project."}{" "}
        Archived projects are hidden from the switcher and can be restored from this page at any
        time.
      </ModalTitle>
      <ModalActions>
        <Button variant="outline" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="dark"
          size="lg"
          className="font-extrabold"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Archiving…" : "Archive project"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

/** "Delete {name} permanently?" with type-the-name-to-confirm (DESIGN.md §3.1 deleteProject). */
export function DeleteProjectModal({
  project,
  pending,
  onClose,
  onConfirm,
}: {
  project: ProjectRowData | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={!!project} onClose={onClose} label="Delete project" locked={pending}>
      {project ? (
        <DeleteBody project={project} pending={pending} onClose={onClose} onConfirm={onConfirm} />
      ) : null}
    </Modal>
  );
}

function DeleteBody({
  project,
  pending,
  onClose,
  onConfirm,
}: {
  project: ProjectRowData;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === project.name;
  const n = project.total;
  return (
    <>
      <ModalTitle title={`Delete ${project.name} permanently?`}>
        This removes {n} experiment{n === 1 ? "" : "s"}, all results, metrics and settings for{" "}
        <b className="font-mono text-foreground">{project.domain}</b>. This can’t be undone.
      </ModalTitle>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-extrabold">
          Type <b>{project.name}</b> to confirm
        </span>
        <input
          value={typed}
          autoFocus
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ok && !pending) onConfirm();
          }}
          className="h-10 rounded-md border border-input px-3 text-[14px] outline-none focus:border-danger focus:ring-3 focus:ring-[rgba(209,59,59,0.12)]"
        />
      </label>
      <ModalActions>
        <Button variant="outline" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <button
          type="button"
          aria-disabled={!ok || pending}
          onClick={() => ok && !pending && onConfirm()}
          className="h-10 rounded-md border-0 px-4 text-[13.5px] font-extrabold text-white"
          style={{
            background: ok && !pending ? "#D13B3B" : "#E9A3A3",
            cursor: ok && !pending ? "pointer" : "not-allowed",
          }}
        >
          {pending ? "Deleting…" : "Delete project"}
        </button>
      </ModalActions>
    </>
  );
}

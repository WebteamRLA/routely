"use client";

import { useEffect, useRef, useState } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import type { Project } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { deleteProjectAction } from "@/server/actions/website.actions";

/*
 * Type-the-name-to-confirm deletion. The Radix AlertDialog primitive supplies role="alertdialog"
 * and the focus trap; its styling is the design's, not `ui/alert-dialog`'s. AlertDialog ignores
 * backdrop clicks by design, but the mockup closes on one, so the overlay handles that itself.
 */

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";
const btnBase = `inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg text-[13px] font-medium whitespace-nowrap disabled:cursor-default disabled:opacity-45 max-[641px]:h-11 ${focusRing}`;

export interface DeleteProjectDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The server deleted it. */
  onDeleted(project: Project): void;
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: DeleteProjectDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open && !!project} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        {project ? (
          <DeletePanel project={project} onOpenChange={onOpenChange} onDeleted={onDeleted} />
        ) : null}
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

function DeletePanel({
  project,
  onOpenChange,
  onDeleted,
}: {
  project: Project;
  onOpenChange(open: boolean): void;
  onDeleted(project: Project): void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const disabled = busy || typed.trim() !== project.name;
  const body = project.total
    ? `This permanently deletes the project, its ${project.total} ${project.total === 1 ? "experiment" : "experiments"}${project.running ? ` (${project.running} running)` : ""} and all their results. Running experiments stop right away and visitors see your original pages. This can’t be undone.`
    : "This permanently deletes the project and its tracking code. This can’t be undone.";

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError("");
    const res = await deleteProjectAction({ websiteId: project.id, confirmName: typed }).catch(
      () => null,
    );
    if (!mounted.current) return;
    setBusy(false);
    if (res?.ok) {
      onDeleted(project);
      return;
    }
    setError(
      res && res.code !== "INTERNAL"
        ? (res.fieldErrors?.confirmName ?? res.message)
        : "Something went wrong on our side. Nothing was deleted — try again in a moment.",
    );
  }

  const close = () => {
    if (!busy) onOpenChange(false);
  };

  return (
    <AlertDialogPrimitive.Overlay
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(17,24,39,.28)] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <AlertDialogPrimitive.Content
        className="relative flex w-full max-w-[460px] animate-[rt-dlg_.16s_ease-out] flex-col gap-[18px] rounded-2xl border border-[#E5E7EB] bg-white p-6 text-[#111827] shadow-[0_24px_64px_#1118272E] outline-none motion-reduce:animate-none"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 flex-[0_0_36px] items-center justify-center rounded-lg bg-[#FEF2F2] text-[#B91C1C]"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h16" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
              <path d="M9 7V4h6v3" />
            </svg>
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <AlertDialogPrimitive.Title className="m-0 text-base leading-6 font-semibold [overflow-wrap:anywhere] text-[#111827]">
              Delete {project.name}?
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="m-0 text-[13px] leading-5 text-pretty text-[#6B7280]">
              {body}
            </AlertDialogPrimitive.Description>
          </div>
        </div>

        <form onSubmit={confirm} className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rt-dl-input" className="text-sm text-[#374151]">
              Type <strong className="font-semibold">{project.name}</strong> to confirm
            </label>
            <input
              ref={inputRef}
              id="rt-dl-input"
              type="text"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setError("");
              }}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "rt-dl-error" : undefined}
              className="h-10 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] max-[641px]:h-11"
            />
            {error ? (
              <p
                id="rt-dl-error"
                role="alert"
                className="m-0 text-[13px] leading-[19px] text-[#B91C1C]"
              >
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-2 max-[641px]:w-full max-[641px]:*:flex-auto">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className={cn(
                btnBase,
                "border border-[#E5E7EB] bg-white px-3.5 text-[#374151] hover:enabled:bg-[#F9FAFB]",
              )}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={disabled}
              className={cn(
                btnBase,
                "border-0 bg-[#B91C1C] px-4 text-white hover:enabled:brightness-[.8]",
              )}
            >
              {busy ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="animate-[spin_.8s_linear_infinite] motion-reduce:animate-none"
                >
                  <path d="M21 12a9 9 0 1 1-6.2-8.56" />
                </svg>
              ) : null}
              {busy ? "Deleting…" : "Delete project"}
            </button>
          </div>
        </form>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Overlay>
  );
}

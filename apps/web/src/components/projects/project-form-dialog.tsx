"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { fixIssuesMessage, normalizeDomain, projectFormErrors, type Project } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { createProjectAction, updateProjectAction } from "@/server/actions/website.actions";

/*
 * Create / edit a project. Built on the bare Radix primitive rather than `ui/dialog` because the
 * design's panel, header and footer share nothing with the shadcn defaults (built-in close
 * button, blurred overlay, zoom animation) — overriding all of that would be longer than this.
 */

// Portals mount on <body>, outside the AppShell that opts into Inter, so the overlay opts in too.
const overlayClass =
  "fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(17,24,39,.28)] p-4";
const panelClass =
  "relative flex max-h-[calc(100vh-32px)] w-full max-w-[560px] animate-[rt-dlg_.16s_ease-out] flex-col overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-white text-[#111827] shadow-[0_24px_64px_#1118272E] outline-none motion-reduce:animate-none";
const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";
const closeClass = `inline-flex size-8 flex-[0_0_32px] cursor-pointer items-center justify-center rounded-lg text-[#6B7280] hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)] ${focusRing}`;
const inputClass =
  "h-10 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] aria-invalid:border-[#DC2626] aria-invalid:focus:border-[#DC2626] aria-invalid:focus:shadow-[0_0_0_3px_rgba(220,38,38,.12)] max-[641px]:h-11";
const btnBase = `inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg text-[13px] whitespace-nowrap disabled:cursor-default disabled:opacity-45 max-[641px]:h-11 ${focusRing}`;
const secondaryClass = `${btnBase} border border-[#E5E7EB] bg-white px-3.5 font-medium text-[#374151] hover:enabled:bg-[#F9FAFB]`;
const primaryClass = `${btnBase} border-0 bg-[#0070C9] px-4 font-semibold text-white hover:enabled:brightness-[.8]`;
const padX = "px-6 max-[641px]:px-4";

export interface ProjectFormDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The project being edited; ignored in create mode. */
  project?: Project;
  /** The workspace's projects, for the instant duplicate checks (the server repeats them). */
  projects: Project[];
  /** The server saved it; this is the fresh row. */
  onSaved(project: Project): void;
  /** Opens pre-filled and already validated — the design's "createErrors" state. */
  initial?: { name: string; url: string; attempted: boolean };
}

export function ProjectFormDialog(props: ProjectFormDialogProps) {
  const { open, onOpenChange, mode, project } = props;
  const isOpen = open && (mode === "create" || !!project);
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass}>
          {/* Mounted only while open, so every opening starts from fresh fields. */}
          <FormPanel {...props} />
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FormPanel({
  mode,
  project,
  projects,
  onOpenChange,
  onSaved,
  initial,
}: ProjectFormDialogProps) {
  const isEdit = mode === "edit" && !!project;
  const [name, setName] = useState(initial?.name ?? (isEdit ? project.name : ""));
  const [url, setUrl] = useState(initial?.url ?? (isEdit ? project.domain : ""));
  const [attempted, setAttempted] = useState(initial?.attempted ?? false);
  const [busy, setBusy] = useState(false);
  /** The server's verdict on the last submission, per field, until that field is edited. */
  const [serverErrs, setServerErrs] = useState<{ name?: string; url?: string }>({});
  /** A failure that is not about a field (no permission, a fault on our side). */
  const [formError, setFormError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const local = projectFormErrors({ name, url }, projects, isEdit ? project.id : null);
  const errs = {
    name: serverErrs.name || local.name,
    url: serverErrs.url || local.url,
  };
  const showE = attempted;
  const errCount = (errs.name ? 1 : 0) + (errs.url ? 1 : 0);
  const nameErr = showE && !!errs.name;
  const urlErr = showE && !!errs.url;

  const newDomain = normalizeDomain(url);
  const unchanged = isEdit && name.trim() === project.name && newDomain === project.domain;
  const domainChanged = isEdit && !errs.url && newDomain !== project.domain;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || (isEdit && unchanged)) return;
    setAttempted(true);
    setFormError("");
    if (errs.name || errs.url) return;
    setBusy(true);
    const res = await (
      isEdit
        ? updateProjectAction({ websiteId: project.id, name, url })
        : createProjectAction({ name, url })
    ).catch(() => null);
    if (!mounted.current) return;
    setBusy(false);
    if (res?.ok) {
      onSaved(res.data);
      return;
    }
    const fields = res?.fieldErrors ?? {};
    if (fields.name || fields.url) {
      setServerErrs({ name: fields.name, url: fields.url });
      return;
    }
    setFormError(
      res && res.code !== "INTERNAL"
        ? res.message
        : "Something went wrong on our side. Your details are still here, so try again in a moment.",
    );
  }

  const close = () => {
    if (!busy) onOpenChange(false);
  };
  const ids = isEdit ? "rt-ed" : "rt-np";

  return (
    <DialogPrimitive.Content
      className={panelClass}
      aria-describedby={undefined}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        nameRef.current?.focus();
      }}
      // A request in flight cannot be abandoned: Escape and backdrop clicks wait for it.
      onEscapeKeyDown={(e) => busy && e.preventDefault()}
      onPointerDownOutside={(e) => busy && e.preventDefault()}
      onInteractOutside={(e) => busy && e.preventDefault()}
    >
      <div className={cn("flex items-start gap-3 pt-5", padX)}>
        <div className="flex min-w-0 flex-auto flex-col gap-1">
          <DialogPrimitive.Title className="m-0 text-base leading-6 font-semibold text-[#111827]">
            {isEdit ? "Edit project" : "New project"}
          </DialogPrimitive.Title>
          <p
            className={cn(
              "m-0 text-sm leading-5 text-[#4B5563]",
              isEdit ? "[overflow-wrap:anywhere]" : "text-pretty",
            )}
          >
            {isEdit
              ? `${project.name} · ${project.domain}`
              : "A project is one website. You’ll get its tracking code in the next step."}
          </p>
        </div>
        <button type="button" aria-label="Close" onClick={close} className={closeClass}>
          <XIcon />
        </button>
      </div>

      <form onSubmit={submit} noValidate className="flex flex-col">
        <div className={cn("flex flex-col gap-4 py-5", padX)}>
          {formError || (!isEdit && showE && errCount > 1) ? (
            <div
              role="alert"
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-sm font-medium text-[#B91C1C]"
            >
              {formError || fixIssuesMessage(errCount)}
            </div>
          ) : null}

          <Field
            id={`${ids}-name`}
            label="Project name"
            help="Shown on the Projects page and in reports."
            error={nameErr ? errs.name : ""}
          >
            <input
              ref={nameRef}
              id={`${ids}-name`}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setServerErrs((cur) => ({ ...cur, name: undefined }));
              }}
              disabled={busy}
              placeholder="e.g. Fernwood Wholesale"
              aria-invalid={nameErr}
              aria-describedby={`${ids}-name-help`}
              maxLength={80}
              autoComplete="off"
              className={inputClass}
            />
          </Field>

          <Field
            id={`${ids}-url`}
            label="Website address"
            help={
              isEdit
                ? "The site where tracking is installed."
                : "The site where you’ll install tracking, like example.com or shop.example.com."
            }
            error={urlErr ? errs.url : ""}
          >
            <input
              id={`${ids}-url`}
              type="text"
              inputMode="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setServerErrs((cur) => ({ ...cur, url: undefined }));
              }}
              disabled={busy}
              placeholder="example.com"
              aria-invalid={urlErr}
              aria-describedby={`${ids}-url-help`}
              maxLength={200}
              autoComplete="off"
              className={inputClass}
            />
          </Field>

          {domainChanged ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FEF3C7] px-3.5 py-3">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#92400E"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 flex-[0_0_16px]"
              >
                <path d="M12 3 2 20h20L12 3z" />
                <path d="M12 10v4" />
                <path d="M12 17v.3" />
              </svg>
              <span className="text-[13px] leading-[19px] text-pretty text-[#92400E]">
                Experiments in this project still target pages on {project.domain}. Install the
                tracking code on {newDomain} and update experiment URLs if the site moved.
              </span>
            </div>
          ) : null}
        </div>

        <div className={cn("flex justify-end border-t border-[#EEF0F3] py-4", padX)}>
          <div className="flex flex-wrap gap-2 max-[641px]:w-full max-[641px]:*:flex-auto">
            <button type="button" onClick={close} disabled={busy} className={secondaryClass}>
              Cancel
            </button>
            <button type="submit" disabled={busy || unchanged} className={primaryClass}>
              {busy ? <Spinner /> : null}
              {isEdit ? (busy ? "Saving…" : "Save changes") : busy ? "Creating…" : "Create project"}
            </button>
          </div>
        </div>
      </form>
    </DialogPrimitive.Content>
  );
}

function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help: string;
  error: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-[#374151]">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-help`} role="alert" className="m-0 text-[13px] leading-[19px] text-[#B91C1C]">
          {error}
        </p>
      ) : (
        <p id={`${id}-help`} className="m-0 text-[13px] leading-[19px] text-[#6B7280]">
          {help}
        </p>
      )}
    </div>
  );
}

function XIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function Spinner() {
  return (
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
  );
}

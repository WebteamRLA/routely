"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import type { ShellProject } from "@/components/layout/types";
import { ProjectIconPreview } from "@/components/projects/project-icon-preview";
import { useFaviconProbe } from "@/components/projects/use-favicon-probe";
import { FormField, Modal, ModalActions, TextInput } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { isValidDomain, normDomain } from "@/lib/domain-normalize";
import { routes } from "@/lib/routes";
import {
  createProjectAction,
  selectProjectAction,
  updateProjectAction,
} from "@/server/actions/project.actions";

export type ProjectModalMode = { kind: "create" } | { kind: "edit"; project: ShellProject };

interface Errors {
  name?: string;
  url?: string;
}

/** The prototype's `projErr` (DESIGN.md §4): same messages, same order. */
function projectErrors(
  name: string,
  url: string,
  projects: ShellProject[],
  selfId?: string,
): Errors {
  const e: Errors = {};
  const d = normDomain(url);
  if (name.trim().length < 2) e.name = "Enter a project name.";
  if (!url.trim()) e.url = "Enter your website URL.";
  else if (!isValidDomain(d)) e.url = "Enter a valid website, e.g. https://www.example.com";
  else if (projects.some((p) => p.id !== selfId && p.domains.includes(d.replace(/:\d+$/, ""))))
    e.url = `A project for ${d} already exists.`;
  return e;
}

/**
 * Create / edit a project (DESIGN.md §3.2). Mounted once by the shell; `mode` null = closed.
 * Saving goes through the real actions — the server normalises the domain, refuses one another
 * project uses, and detects and stores the favicon. The icon shown here is a client-side
 * preview of the same lookup.
 */
export function ProjectModal({
  mode,
  projects,
  onClose,
}: {
  mode: ProjectModalMode | null;
  projects: ShellProject[];
  onClose: () => void;
}) {
  if (!mode) return null;
  return (
    <ProjectModalBody
      key={mode.kind === "edit" ? mode.project.id : "create"}
      mode={mode}
      projects={projects}
      onClose={onClose}
    />
  );
}

function ProjectModalBody({
  mode,
  projects,
  onClose,
}: {
  mode: ProjectModalMode;
  projects: ShellProject[];
  onClose: () => void;
}) {
  const router = useRouter();
  const editing = mode.kind === "edit" ? mode.project : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [url, setUrl] = useState(editing?.domain ?? "");
  const [show, setShow] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();
  const { probe, onUrlChange, onUrlBlur } = useFaviconProbe(
    editing?.iconUrl
      ? { status: "ok", domain: editing.domain, src: editing.iconUrl }
      : { status: "idle" },
  );

  // Editing an existing project with no stored icon: look it up once, as the prototype does
  // when the modal opens on a known domain.
  useEffect(() => {
    if (editing && !editing.iconUrl) onUrlBlur(editing.domain);
  }, [editing, onUrlBlur]);

  const clientErrors = show ? projectErrors(name, url, projects, editing?.id) : {};
  const errors: Errors = { ...serverErrors, ...clientErrors };
  const domain = normDomain(url);
  const domainOk = isValidDomain(domain);

  function save() {
    const found = projectErrors(name, url, projects, editing?.id);
    setShow(true);
    setServerErrors({});
    if (found.name || found.url || pending) return;
    startTransition(async () => {
      if (editing) {
        const result = await updateProjectAction({ projectId: editing.id, name, url });
        if (result.status === "error") return fail(result);
        onClose();
        router.refresh();
        toast(`Project updated · ${result.data.name} · ${result.data.domain}`);
        return;
      }
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await createProjectAction({ name, url, timezone });
      if (result.status === "error") return fail(result);
      await selectProjectAction(result.data.id);
      onClose();
      router.push(routes.project(result.data.id).dashboard);
      toast(`Project “${result.data.name}” created · now viewing ${result.data.domain}`);
    });
  }

  function fail(result: { message: string; fieldErrors?: Record<string, string[]> }) {
    const fe = result.fieldErrors ?? {};
    const next: Errors = {
      name: fe["name"]?.[0],
      url: fe["domain"]?.[0] ?? fe["url"]?.[0],
    };
    if (!next.name && !next.url) toast.error(result.message);
    setServerErrors(next);
  }

  return (
    <Modal
      open
      onClose={onClose}
      label={editing ? "Project details" : "Add a website"}
      locked={pending}
    >
      <div>
        <div className="text-[11.5px] font-extrabold tracking-[0.12em] text-coral">
          {editing ? "EDIT PROJECT" : "NEW PROJECT"}
        </div>
        <div className="mt-1 font-heading text-[20px] font-bold tracking-[-0.01em]">
          {editing ? "Project details" : "Add a website"}
        </div>
      </div>
      <div className="text-[13.5px] leading-[1.5] text-ink-2">
        {editing
          ? "Renaming doesn’t affect running experiments. Changing the website moves the primary domain; install the Routely snippet on the new domain before launching."
          : "Each project is one website with its own experiments, results, metrics and settings. You can switch between projects at any time."}
      </div>
      <form
        className="flex flex-col gap-3.5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <FormField label="Project name" htmlFor="project-name" error={errors.name}>
          <TextInput
            id="project-name"
            value={name}
            autoFocus
            invalid={!!errors.name}
            placeholder="e.g. Northwind Coffee"
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField
          label="Website URL"
          htmlFor="project-url"
          error={errors.url}
          help={
            !errors.url && domainOk ? (
              <>
                Experiments will run on{" "}
                <b className="font-mono text-foreground">{domain.replace(/:\d+$/, "")}</b> and its
                subdomains. You can add more domains later in Settings.
              </>
            ) : null
          }
        >
          <TextInput
            id="project-url"
            mono
            value={url}
            invalid={!!errors.url}
            placeholder="https://www.example.com"
            onChange={(e) => {
              setUrl(e.target.value);
              onUrlChange(e.target.value);
            }}
            onBlur={(e) => onUrlBlur(e.target.value)}
          />
        </FormField>
        <ProjectIconPreview probe={probe} name={name} url={url} />
        <ModalActions>
          <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="lg" className="font-extrabold" disabled={pending}>
            {pending
              ? editing
                ? "Saving…"
                : "Creating…"
              : editing
                ? "Save changes"
                : "Create project"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

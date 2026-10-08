"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";

import { routes } from "@/lib/routes";
import {
  deleteProjectExperimentAction,
  duplicateExperimentAction,
  pauseExperimentAction,
  resumeExperimentAction,
} from "@/server/actions/experiment.actions";

/**
 * Lifecycle actions shared by the list's row menus and the detail header. Each calls the real
 * Server Action, toasts the prototype's copy, and refreshes or navigates.
 */
export function useExperimentActions(projectId: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const project = routes.project(projectId);

  const pause = useCallback(
    (experimentId: string) =>
      startTransition(async () => {
        const r = await pauseExperimentAction({ projectId, experimentId });
        if (r.status === "error") return void toast.error(r.message);
        toast("Paused · visitors now see Control");
        router.refresh();
      }),
    [projectId, router],
  );

  const resume = useCallback(
    (experimentId: string) =>
      startTransition(async () => {
        const r = await resumeExperimentAction({ projectId, experimentId });
        if (r.status === "error") return void toast.error(r.message);
        toast("Experiment resumed");
        router.refresh();
      }),
    [projectId, router],
  );

  const duplicate = useCallback(
    (experimentId: string) =>
      startTransition(async () => {
        const r = await duplicateExperimentAction({ projectId, experimentId });
        if (r.status === "error") return void toast.error(r.message);
        toast("Duplicated as a draft");
        router.push(project.experiment(r.data.id));
      }),
    [projectId, project, router],
  );

  /** Resolves true on success so the caller can close its modal. */
  const remove = useCallback(
    (experimentId: string, opts: { thenList?: boolean } = {}) =>
      new Promise<boolean>((resolve) =>
        startTransition(async () => {
          const r = await deleteProjectExperimentAction({ projectId, experimentId });
          if (r.status === "error") {
            toast.error(r.message);
            return resolve(false);
          }
          toast("Experiment deleted");
          if (opts.thenList) router.push(project.experiments());
          else router.refresh();
          resolve(true);
        }),
      ),
    [projectId, project, router],
  );

  return { pending, pause, resume, duplicate, remove };
}

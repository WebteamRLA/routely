"use client";

import { useActionState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { IDLE, type FormState } from "@/lib/form-state";

/**
 * Confirmation before deleting an experiment.
 *
 * Deletion cascades to every assignment, event and conversion recorded under the experiment,
 * so the dialog names what is actually lost. For an experiment that has collected results,
 * archiving is offered as the alternative in the copy — it keeps the data and simply stops
 * collecting more, which is what most people reaching for "delete" on a finished test want.
 *
 * The form is rendered outside the dialog and the confirm button is associated with it by
 * `form=`, matching `DeleteWebsiteDialog`: Radix portals dialog content and only mounts it
 * while open, so a nested form would exist only transiently.
 */
export function DeleteExperimentDialog({
  action,
  experimentId,
  websiteId,
  experimentName,
  hasResults,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  experimentId: string;
  /** Where the action redirects afterwards. */
  websiteId: string;
  experimentName: string;
  /** Whether anything has been recorded, which changes what deletion costs. */
  hasResults: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  useFormToast(state);
  const formId = `delete-experiment-${experimentId}`;

  return (
    <>
      <form id={formId} action={formAction} className="hidden">
        <input type="hidden" name="experimentId" value={experimentId} />
        <input type="hidden" name="websiteId" value={websiteId} />
      </form>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive-outline">Delete experiment</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{experimentName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasResults
                ? "This permanently deletes the experiment and every visitor, event and conversion it recorded. If you only want it to stop running, archive it instead — that keeps the results."
                : "This permanently deletes the experiment. It has recorded nothing, so no results are lost."}{" "}
              It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            {/* `useFormStatus` needs a descendant of the form, so pending state comes from
                `useActionState` instead — the button is associated, not nested. */}
            <Button type="submit" form={formId} variant="destructive" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

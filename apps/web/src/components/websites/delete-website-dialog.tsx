"use client";

import { useActionState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import { Loader2, Trash2 } from "lucide-react";

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
 * Confirmation before deleting a website.
 *
 * Deletion cascades to every experiment, visitor, event and conversion beneath the website, so
 * the dialog states what will actually be lost rather than asking a generic "are you sure?".
 *
 * The form is rendered outside the dialog and the confirm button is associated with it by
 * `form=`. Radix portals dialog content to the end of the body and only mounts it while open,
 * so a form nested inside would exist only transiently — this way the form is part of the
 * server-rendered page and the submission survives the dialog closing.
 */
export function DeleteWebsiteDialog({
  action,
  websiteId,
  websiteName,
  experimentCount,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  websiteId: string;
  websiteName: string;
  experimentCount: number;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  useFormToast(state);
  const formId = `delete-website-${websiteId}`;

  return (
    <>
      <form id={formId} action={formAction} className="hidden">
        <input type="hidden" name="websiteId" value={websiteId} />
      </form>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive-outline" className="self-start sm:self-auto">
            <Trash2 aria-hidden />
            Delete website
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{websiteName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {experimentCount > 0
                ? `This permanently deletes ${experimentCount} experiment${
                    experimentCount === 1 ? "" : "s"
                  } and all of their collected visitors, events and conversions.`
                : "This permanently deletes the website and its tracking snippet."}{" "}
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

"use client";

import { useActionState } from "react";
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
import { useFormToast } from "@/hooks/use-form-toast";
import { IDLE, type FormState } from "@/lib/form-state";

/**
 * Confirmation before disconnecting Google Sheets.
 *
 * States what is actually lost, because the obvious fear — "will this delete my spreadsheet?" — is
 * the one thing that does *not* happen. Rows already written stay exactly where they are.
 *
 * The form sits outside the dialog and the confirm button is associated by `form=`, the same
 * arrangement as `DeleteWebsiteDialog`: Radix portals dialog content and only mounts it while open,
 * so a nested form would exist only transiently.
 */
export function DisconnectDialog({
  action,
  googleEmail,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  googleEmail: string | null;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  useFormToast(state);
  const formId = "disconnect-google-sheets";

  return (
    <>
      <form id={formId} action={formAction} className="hidden" />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive-outline">Disconnect</Button>
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Sheets?</AlertDialogTitle>
            <AlertDialogDescription>
              Routely will revoke its access to{" "}
              {googleEmail ? (
                <span className="font-bold text-foreground">{googleEmail}</span>
              ) : (
                "your Google account"
              )}{" "}
              and stop the daily sync. The chosen destination and the sync history are deleted.
              <br />
              <br />
              Your spreadsheet and every row already written to it are left untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button type="submit" form={formId} variant="destructive" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

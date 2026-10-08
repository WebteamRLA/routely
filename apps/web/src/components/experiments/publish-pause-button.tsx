"use client";

import { useActionState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IDLE, type FormState } from "@/lib/form-state";

type Status = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";

/**
 * The single most useful lifecycle action for a given status, as a compact list control.
 *
 * A draft or a paused experiment publishes; a running one pauses; an archived one offers
 * nothing, because ARCHIVED is terminal. Anything more (archiving, going back to draft) lives
 * on the experiment's own page — a list row is the wrong place to make a decision that needs
 * context.
 *
 * A failure — most often the "another experiment already targets this control URL" conflict —
 * is shown inline here, because sending the user to another page to read why a one-click
 * action failed would lose their place in the list.
 */
export function PublishPauseButton({
  action,
  experimentId,
  status,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  experimentId: string;
  status: Status;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  useFormToast(state);

  if (status === "ARCHIVED") return null;

  const publishing = status !== "ACTIVE";

  return (
    <form action={formAction}>
      <input type="hidden" name="experimentId" value={experimentId} />
      <input type="hidden" name="status" value={publishing ? "ACTIVE" : "PAUSED"} />

      <Button
        type="submit"
        size="sm"
        variant={publishing ? "default" : "outline"}
        disabled={isPending}
      >
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {publishing ? "Publish" : "Pause"}
      </Button>
    </form>
  );
}

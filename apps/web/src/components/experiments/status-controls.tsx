"use client";

import { useActionState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import { Archive, Loader2, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IDLE, type FormState } from "@/lib/form-state";

type Status = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";

const TRANSITIONS: Record<
  Status,
  { label: string; icon: typeof Play; variant?: "default" | "outline" | "destructive" }
> = {
  ACTIVE: { label: "Start experiment", icon: Play, variant: "default" },
  PAUSED: { label: "Pause", icon: Pause, variant: "outline" },
  COMPLETED: { label: "End", icon: Archive, variant: "outline" },
  DRAFT: { label: "Back to draft", icon: Play, variant: "outline" },
};

/**
 * Lifecycle buttons for an experiment.
 *
 * Which transitions are offered comes from the server — the same `ALLOWED_TRANSITIONS` table
 * the service enforces — so the UI can never present a move the service would reject.
 *
 * Resuming a paused experiment reads as "Resume" rather than "Start", because the wording is
 * the only cue that its existing results are being continued rather than restarted.
 */
export function StatusControls({
  action,
  experimentId,
  currentStatus,
  allowed,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  experimentId: string;
  currentStatus: Status;
  allowed: readonly Status[];
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  useFormToast(state);

  if (allowed.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This experiment has ended. Its results are kept, but it will not collect anything new.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="experimentId" value={experimentId} />

        {allowed.map((status) => {
          const { label, icon: Icon, variant } = TRANSITIONS[status];
          const text =
            status === "ACTIVE" && currentStatus === "PAUSED" ? "Resume experiment" : label;

          return (
            <Button
              key={status}
              type="submit"
              name="status"
              value={status}
              variant={variant}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
              {text}
            </Button>
          );
        })}
      </form>
    </div>
  );
}

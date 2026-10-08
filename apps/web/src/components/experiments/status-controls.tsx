"use client";

import { useActionState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IDLE, type FormState } from "@/lib/form-state";

type Status = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";

const TRANSITIONS: Record<Status, { label: string; variant: "default" | "outline" | "dark" }> = {
  ACTIVE: { label: "Start experiment", variant: "default" },
  PAUSED: { label: "Pause", variant: "outline" },
  ARCHIVED: { label: "Archive", variant: "dark" },
  DRAFT: { label: "Back to draft", variant: "outline" },
};

/** Resuming takes the design's green "Resume" treatment, distinct from a first start. */
const RESUME_CLASS =
  "border-success bg-success text-white hover:border-success-strong hover:bg-success-strong";

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
      <p className="text-[13px] text-ink-3">
        This experiment is archived. Its results are kept, but it will not collect anything new.
      </p>
    );
  }

  return (
    <div>
      <form action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="experimentId" value={experimentId} />

        {allowed.map((status) => {
          const { label, variant } = TRANSITIONS[status];
          const resuming = status === "ACTIVE" && currentStatus === "PAUSED";
          const text = resuming ? "Resume experiment" : label;

          return (
            <Button
              key={status}
              type="submit"
              name="status"
              value={status}
              variant={variant}
              disabled={isPending}
              className={resuming ? RESUME_CLASS : undefined}
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {text}
            </Button>
          );
        })}
      </form>
    </div>
  );
}

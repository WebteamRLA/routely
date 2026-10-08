"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useFormToast } from "@/hooks/use-form-toast";
import { IDLE, type FormState } from "@/lib/form-state";
import type { Metric } from "@/server/services/metrics.service";

/** The confirmation every deletion goes through, single or bulk. */
export function DeleteMetricsDialog({
  metrics,
  open,
  onOpenChange,
  action,
  onDeleted,
}: {
  metrics: Metric[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  onDeleted: () => void;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  const formId = "delete-metrics";
  useFormToast(state);

  // Clearing the selection has to happen in an effect: it updates the table above this
  // component, and React forbids updating another component mid-render.
  const handled = useRef(state);
  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.status === "success") {
      onOpenChange(false);
      onDeleted();
    }
  }, [state, onOpenChange, onDeleted]);

  const one = metrics.length === 1;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {one ? "this metric" : `${metrics.length} metrics`}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            A conversion goal belongs to an experiment and cannot exist without one, so this deletes{" "}
            {one ? "the experiment that owns it" : "the experiments that own them"} — along with
            every assignment, event and conversion recorded so far. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-subtle p-3 text-[13.5px]">
          {metrics.map((metric) => (
            <li key={metric.experimentId} className="truncate">
              <span className="font-bold">{metric.name}</span>{" "}
              <span className="text-ink-3">· {metric.experimentName}</span>
            </li>
          ))}
        </ul>

        <form id={formId} action={formAction}>
          {metrics.map((metric) => (
            <input
              key={metric.experimentId}
              type="hidden"
              name="experimentId"
              value={metric.experimentId}
            />
          ))}
        </form>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          {/* `useFormStatus` needs a descendant of the form, so pending state comes from
              `useActionState` instead — the button is associated, not nested. */}
          <Button type="submit" form={formId} variant="destructive" disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Delete {one ? "experiment" : "experiments"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

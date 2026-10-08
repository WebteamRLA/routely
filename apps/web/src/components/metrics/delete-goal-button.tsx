"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { DeleteMetricsDialog } from "@/components/metrics/delete-metrics-dialog";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import type { FormState } from "@/lib/form-state";
import type { Metric } from "@/server/services/metrics.service";

/**
 * Delete, from a goal's own setup page.
 *
 * Shares `DeleteMetricsDialog` with the list rather than posting straight to the action: the
 * consequence being confirmed — that this removes the experiment and every result it has
 * collected — is the same one either way, and a second copy of that sentence is a second
 * chance for the two to disagree.
 */
export function DeleteGoalButton({
  metric,
  action,
}: {
  metric: Metric;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button type="button" variant="destructive-outline" onClick={() => setOpen(true)}>
        Delete
      </Button>

      <DeleteMetricsDialog
        metrics={[metric]}
        open={open}
        onOpenChange={setOpen}
        action={action}
        // The page being viewed no longer exists, so returning to the list is the only sane
        // destination.
        onDeleted={() => router.push(routes.metrics.list)}
      />
    </>
  );
}

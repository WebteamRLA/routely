"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";

import { SubmitButton } from "@/components/common/submit-button";
import { useFormToast } from "@/hooks/use-form-toast";
import { IDLE, type FormState } from "@/lib/form-state";

/**
 * Rewrites the spreadsheet now.
 *
 * Mostly unnecessary — traffic refreshes the tab within seconds on its own — but it exists so
 * somebody setting this up can confirm it works without waiting for a visitor, and so a tab left
 * stale by a Google outage can be brought back by hand.
 *
 * Safe to press repeatedly: the tab is overwritten from the database each time, so a second press
 * produces exactly the same cells as the first.
 */
export function RefreshSheetButton({
  action,
  websiteId,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  websiteId: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  useFormToast(state);

  return (
    <form action={formAction}>
      <input type="hidden" name="websiteId" value={websiteId} />
      <SubmitButton variant="outline" size="sm" pendingLabel="Refreshing…">
        <RefreshCw aria-hidden />
        Refresh now
      </SubmitButton>
    </form>
  );
}

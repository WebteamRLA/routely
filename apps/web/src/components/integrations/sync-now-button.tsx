"use client";

import { useActionState, useState } from "react";
import { RefreshCw } from "lucide-react";

import { SubmitButton } from "@/components/common/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormToast } from "@/hooks/use-form-toast";
import { IDLE, type FormState } from "@/lib/form-state";
import { previousUtcDay, utcDayKey } from "@/lib/utc-day";

/**
 * Writes one day's rows on demand.
 *
 * Defaults to yesterday, which is what the scheduled sweep writes — but the day is editable, and
 * that is the point. Always-yesterday is useless on the day someone sets this up: a website
 * connected today has no data for yesterday, so the only thing the button can report is "nothing to
 * write", which reads exactly like a broken integration rather than a working one with nothing to
 * say. Being able to pick today is what lets someone confirm the pipeline works while they are
 * looking at it.
 *
 * Pressing it twice for the same day is safe — the second attempt reports that the day was already
 * synced rather than appending it again — and the toast says which of those happened.
 */
export function SyncNowButton({
  action,
  websiteId,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  websiteId: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  useFormToast(state);

  // Computed once on mount. Both are UTC, matching the boundary every row is written against — a
  // browser-local date would offer a day the sync does not recognise.
  const [today] = useState(() => utcDayKey(new Date()));
  const [yesterday] = useState(() => previousUtcDay());
  const [day, setDay] = useState(yesterday);

  const isToday = day === today;

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="websiteId" value={websiteId} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`sync-day-${websiteId}`} className="text-xs text-muted-foreground">
            Day to write (UTC)
          </Label>
          <Input
            id={`sync-day-${websiteId}`}
            name="day"
            type="date"
            value={day}
            max={today}
            onChange={(event) => setDay(event.target.value)}
            className="h-9 w-40"
          />
        </div>

        <SubmitButton variant="outline" size="sm" pendingLabel="Syncing…">
          <RefreshCw aria-hidden />
          Sync this day
        </SubmitButton>
      </div>

      {isToday ? (
        <p className="text-xs text-muted-foreground">
          Today is still in progress, so this writes the results so far. The scheduled run will not
          add the rest of today afterwards — pick yesterday for a complete day.
        </p>
      ) : null}
    </form>
  );
}

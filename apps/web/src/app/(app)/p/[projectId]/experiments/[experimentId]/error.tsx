"use client";

import { ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";

export default function ExperimentDetailError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-[18px]">
      <ErrorCard
        title="Results are temporarily unavailable"
        body="The reporting service didn’t respond. Visitor assignment and tracking are unaffected, so no data is lost."
        action={
          <Button variant="dark" size="sm" className="h-9" onClick={reset}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

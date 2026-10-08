"use client";

import { ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";

export default function ExperimentsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-[18px]">
      <ErrorCard
        title="Experiments failed to load"
        body="The request didn’t complete. Nothing has changed with your running experiments."
        action={
          <Button variant="dark" size="sm" className="h-9" onClick={reset}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

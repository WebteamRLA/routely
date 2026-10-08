"use client";

import { ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";

export default function MetricsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <ErrorCard
        eyebrow="Metrics & goals"
        title="We couldn’t load your metrics"
        body="Something went wrong on our side. Tracking keeps running while this page is down."
        action={
          <Button variant="dark" onClick={reset}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

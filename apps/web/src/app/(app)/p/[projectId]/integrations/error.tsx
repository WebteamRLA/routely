"use client";

import { ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";

export default function IntegrationsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <ErrorCard
        eyebrow="Integrations"
        title="We couldn’t load your integrations"
        body="Something went wrong on our side. Syncing and tracking are not affected by this page."
        action={
          <Button variant="dark" onClick={reset}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

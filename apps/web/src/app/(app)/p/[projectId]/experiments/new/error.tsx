"use client";

import { ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";

export default function WizardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-[18px]">
      <ErrorCard
        eyebrow="Couldn’t open the wizard"
        title="We couldn’t load this experiment’s setup"
        body="Nothing was changed. Try again in a moment."
        action={
          <Button variant="dark" size="sm" className="h-9" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}

"use client";

import { ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";

export default function SettingsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <ErrorCard
        eyebrow="Settings"
        title="We couldn’t load these settings"
        body="Something went wrong on our side. Your project and its data are unaffected."
        action={
          <Button variant="dark" onClick={reset}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

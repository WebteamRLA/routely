"use client";

import { useEffect } from "react";

import { ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";

export default function ProjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[routely] projects error", error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <ErrorCard
        eyebrow="Couldn't load projects"
        title="Your projects failed to load"
        body="Nothing has changed with your projects or running experiments. Try again in a moment."
        action={
          <Button variant="dark" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}

"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";

/**
 * Catches uncaught exceptions thrown while rendering any route that has no closer boundary.
 * Nested `error.tsx` files handle their own subtrees so the shell stays interactive.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[routely] route error", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center bg-background px-4">
      <ErrorCard
        eyebrow="Couldn’t load"
        title="Something went wrong"
        body={
          <>
            <p className="m-0 text-[14px]">
              We could not load this page. Try again, and if it keeps happening let us know.
            </p>
            {error.digest ? (
              <p className="m-0 mt-1 font-mono text-[12px]">Reference: {error.digest}</p>
            ) : null}
          </>
        }
        action={
          <Button variant="dark" onClick={reset}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        }
        className="w-full"
      />
    </div>
  );
}

"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { ErrorCard } from "@/components/rl";
import { Button } from "@/components/ui/button";

/**
 * Dashboard-scoped error boundary. Because it sits inside the app layout, the sidebar and top
 * bar stay rendered and interactive while only the page content is replaced.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[routely] dashboard error", error);
  }, [error]);

  return (
    <ErrorCard
      eyebrow="Couldn’t load"
      title="Something went wrong"
      body={
        <>
          <p className="m-0 text-sm">
            We could not load this page. Try again, and if it keeps happening let us know.
          </p>
          {error.digest ? (
            <p className="m-0 mt-1 font-mono text-xs">Reference: {error.digest}</p>
          ) : null}
        </>
      }
      action={
        <Button variant="dark" onClick={reset}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
      }
    />
  );
}

"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/common/error-state";

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
      <ErrorState digest={error.digest} onRetry={reset} className="w-full" />
    </div>
  );
}

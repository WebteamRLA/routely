"use client";

import { SubmitButton } from "@/components/common/submit-button";

/**
 * Starts the Google consent flow.
 *
 * A real `<form method="post">` to the start route rather than a link, because that route is POST
 * on purpose: a GET would be minted by a link prefetch or a crawler, setting a state cookie for a
 * flow nobody asked to begin. A plain form also means this works without JavaScript — the only
 * thing the client component adds is the pending state on the button.
 */
export function ConnectGoogleButton({
  label = "Connect Google Sheets",
  variant = "default",
}: {
  label?: string;
  variant?: "default" | "outline" | "dark" | "destructive-outline";
}) {
  return (
    <form action="/api/integrations/google/start" method="post">
      <SubmitButton pendingLabel="Redirecting to Google…" variant={variant}>
        {label}
      </SubmitButton>
    </form>
  );
}

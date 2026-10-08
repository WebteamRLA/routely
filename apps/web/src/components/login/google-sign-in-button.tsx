"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/** Google's brand mark, inlined so the button needs no network request to render. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Submit button for the sign-in form.
 *
 * `useFormStatus` reads the pending state of the enclosing form, so the button can disable
 * itself and show a spinner for the whole round trip to Google without the page needing any
 * client-side state of its own.
 */
export function GoogleSignInButton({ disabled = false }: { disabled?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      // The design's primary-button proportions (46px, 6px radius, 14.5px/800), but on a white
      // surface: Google's branding guidance keeps the multicolour mark on a neutral background,
      // and a blue fill would make it read as a generic button rather than "Sign in with Google".
      className="h-[46px] w-full gap-2.5 rounded-md border-input bg-card text-[14.5px] font-extrabold text-foreground hover:bg-background"
      disabled={disabled || pending}
    >
      {pending ? (
        <span
          aria-hidden
          className="size-4 animate-rl-spin rounded-full border-2 border-brand/25 border-t-brand"
        />
      ) : (
        <GoogleMark />
      )}
      {pending ? "Redirecting to Google…" : "Continue with Google"}
    </Button>
  );
}

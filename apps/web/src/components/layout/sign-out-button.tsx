"use client";

import { useFormStatus } from "react-dom";

/**
 * The account menu's "Log out" item.
 *
 * Rendered as the enclosing form's submit button, so signing out is a plain form submission to
 * a Server Action — no client-side session library, and it still works if JavaScript fails to
 * load. `useFormStatus` needs to be inside the form, which is why this is its own component.
 */
export function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="block w-full cursor-pointer rounded-sm px-2.5 py-[9px] text-left text-[13.5px] font-bold text-danger-text outline-none hover:bg-danger-bg focus-visible:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

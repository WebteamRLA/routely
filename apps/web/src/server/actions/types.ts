import "server-only";

import type { FormState } from "@/lib/form-state";
import { toPublicError } from "@/server/errors";

export type { FormState } from "@/lib/form-state";

/**
 * Runs a service call and converts a thrown `AppError` into form state.
 *
 * Framework control-flow errors — `redirect()` and `notFound()` — must reach Next.js
 * untouched, so callers perform their redirect *after* this resolves rather than inside it.
 */
export async function runAction<T>(
  operation: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; state: FormState }> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const { message } = toPublicError(error);
    const fieldErrors =
      error instanceof Object && "fieldErrors" in error
        ? (error.fieldErrors as Record<string, string[]> | undefined)
        : undefined;

    return {
      ok: false,
      state: { status: "error", message, ...(fieldErrors ? { fieldErrors } : {}) },
    };
  }
}

/**
 * Result of the RPC-style Server Actions the new UI calls directly (not through a `<form>`).
 * FormState-compatible — `status`, `message` and `fieldErrors` mean the same — plus `data` on
 * success, so a component can use it with `useActionState` or `await` it in a transition.
 *
 * Field-error keys are the input names; for experiment drafts they are `step.field`
 * (`basics.url`, `variants.v1`, `goal.conv`, …).
 */
export type ActionResult<T = null> =
  | { status: "success"; data: T; message?: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

/** Runs a service call and wraps its outcome as an `ActionResult`. */
export async function runResult<T>(
  operation: () => Promise<T>,
  message?: string,
): Promise<ActionResult<T>> {
  const result = await runAction(operation);
  if (!result.ok) {
    return {
      status: "error",
      message: result.state.message ?? "Something went wrong. Please try again.",
      ...(result.state.fieldErrors ? { fieldErrors: result.state.fieldErrors } : {}),
    };
  }
  return { status: "success", data: result.data, ...(message ? { message } : {}) };
}

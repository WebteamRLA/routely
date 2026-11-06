import { isAppError, toPublicError } from "@/server/errors";

/**
 * A result a client component can render directly. A thrown `AppError` would cross the server
 * boundary as `{}`, so failures come back as values.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

export async function toActionResult<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const { code, message } = toPublicError(error);
    const fieldErrors: Record<string, string> = {};
    if (isAppError(error)) {
      for (const [key, messages] of Object.entries(error.fieldErrors ?? {})) {
        if (messages[0]) fieldErrors[key] = messages[0];
      }
    }
    return {
      ok: false,
      code,
      message,
      ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    };
  }
}

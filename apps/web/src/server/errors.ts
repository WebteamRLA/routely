import "server-only";

/**
 * Application error taxonomy.
 *
 * Service functions throw these instead of raw `Error`s so the transport layer (route
 * handlers, Server Actions, page boundaries) can map a failure to the right status code and
 * user-facing message without string-matching. Anything that is *not* an `AppError` is an
 * unexpected fault and must never have its message shown to a user.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Field-level messages, keyed by form field name. */
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { cause?: unknown; fieldErrors?: Record<string, string[]> },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fieldErrors = options?.fieldErrors;
  }
}

export const unauthenticated = (message = "You must be signed in.") =>
  new AppError("UNAUTHENTICATED", message);

/**
 * A **member** of the workspace lacks the role for this action. Only ever thrown after membership
 * has been established — a non-member gets `notFound`, so an id cannot be probed for existence.
 * Saying "forbidden" to a member leaks nothing: they can already see the record.
 */
export const forbidden = (message = "You don’t have permission to do that.") =>
  new AppError("FORBIDDEN", message);

export const notFound = (message = "That resource does not exist.") =>
  new AppError("NOT_FOUND", message);

export const validationFailed = (message: string, fieldErrors?: Record<string, string[]>) =>
  new AppError("VALIDATION", message, { fieldErrors });

export const conflict = (message = "That change conflicts with the current state.") =>
  new AppError("CONFLICT", message);

export const rateLimited = (message = "Too many requests. Please slow down.") =>
  new AppError("RATE_LIMITED", message);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Converts any thrown value into something safe to show a user. Unexpected faults are logged
 * server-side and reported generically so internals never leak into a response.
 */
export function toPublicError(error: unknown): { code: AppErrorCode; message: string } {
  if (isAppError(error)) {
    return { code: error.code, message: error.message };
  }

  console.error("[routely] unhandled error", error);
  return { code: "INTERNAL", message: "Something went wrong. Please try again." };
}

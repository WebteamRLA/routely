import type { NextRequest } from "next/server";

import { requireUser } from "@/server/auth/session";
import { isAppError, toPublicError } from "@/server/errors";
import { issueEditorSession } from "@/server/services/visual-editor.service";

/**
 * `POST /api/editor/token` — opens a visual editor session on an A/B test's tested page.
 *
 *   { "experimentId": "…" }  →  200 { token, expiresAt, pageUrl, frameUrl, origin, snippet }
 *
 * Errors are `{ error: { code, message } }` with the AppError status: 401 signed out, 403 a Viewer,
 * 404 an experiment outside the actor's workspaces, 422 no usable tested page, 429 too many.
 *
 * Only the dashboard calls this, from its own origin, so it insists on a JSON body: a cross-site
 * page cannot send one without a CORS preflight, which this route does not answer. (The token
 * grants no data access anyway — see `visual-editor.service.ts` — but there is no reason to let
 * another site mint one in a signed-in user's name.)
 *
 * The Prisma adapter is a Node database driver, so this cannot run on the Edge runtime.
 */
export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function failure(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return failure("VALIDATION", "Send a JSON body.", 415);
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return failure("FORBIDDEN", "Cross-site requests are not accepted.", 403);
  }

  try {
    const user = await requireUser();
    const body: unknown = await request.json().catch(() => null);
    return json(await issueEditorSession(user.id, body), 200);
  } catch (error) {
    const { code, message } = toPublicError(error);
    if (!isAppError(error)) console.error("[routely] editor token failed", error);
    return failure(code, message, isAppError(error) ? error.status : 500);
  }
}

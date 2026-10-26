import { getSession } from "@/server/auth/session";
import { projectFavicon } from "@/server/services/favicon.service";

/**
 * A project's favicon (`server/services/favicon.service.ts`), for its tile.
 *
 *   GET /api/favicon/<websiteId>   200 image/… · 404 (no icon, or not your project)
 *
 * Signed-in members of the project's workspace only, and the same 404 for "not yours" as for "no
 * icon", so an id cannot be probed. The tile shows the project's letter on any 404.
 */

export const runtime = "nodejs";

const SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  // Opened directly, it is an inert image: no script, no subresources, no same-origin access.
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const { websiteId } = await params;
  const session = await getSession();
  const icon = session ? await projectFavicon(session.user.id, websiteId) : null;

  if (!icon) {
    return new Response(null, {
      status: 404,
      headers: { ...SAFE_HEADERS, "Cache-Control": "private, max-age=3600" },
    });
  }

  return new Response(new Uint8Array(icon.bytes), {
    headers: {
      ...SAFE_HEADERS,
      "Content-Type": icon.type,
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

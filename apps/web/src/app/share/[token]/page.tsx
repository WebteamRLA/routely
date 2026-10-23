import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SharedResultsView } from "@/components/experiment/shared-results-view";
import { readViewerTimeZone } from "@/server/http/viewer-time-zone";
import { getSharedResults } from "@/server/services/experiment-results.service";

/**
 * Public, read-only results.
 *
 * Reached by an unguessable token and nothing else — no session, and no way to navigate from
 * here to anything the viewer was not given. It renders the same Results tab the team sees,
 * built by the same results service, and nothing more: no Review tab (which names teammates and
 * shows tracking internals), no account, no other experiment, no link into the dashboard.
 *
 * Outside the `(app)` route group on purpose, so it inherits neither the authenticated layout
 * nor the proxy's protected prefixes.
 */

/** Never indexed: a share link is private-by-obscurity, and a crawler would defeat that. */
export const metadata: Metadata = {
  title: "Experiment results",
  robots: { index: false, follow: false, nocache: true },
};

export default async function SharedResultsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const timeZone = await readViewerTimeZone();
  const model = await getSharedResults(token, { timeZone });

  // An unknown token and a revoked one are the same 404. Distinguishing them would tell a
  // stranger that a link once existed, which is not theirs to learn.
  if (!model) notFound();

  return <SharedResultsView model={model} timeZone={timeZone} />;
}

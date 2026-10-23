import type { Metadata } from "next";

import { IntegrationsCatalog } from "@/components/integrations-catalog/integrations-catalog";
import { INTEGRATIONS_VIEWS } from "@/lib/mock/integrations";
import { readView, type SearchParams } from "@/lib/view-param";
import { requireSession } from "@/server/auth/session";
import { getIntegrationsCard } from "@/server/services/sheets-sync.service";

export const metadata: Metadata = { title: "Integrations" };

/**
 * Integrations — the catalog of tools Routely reports to (today, Google Sheets), for the active
 * workspace.
 *
 * The card's state comes from the workspace's Google grant and its projects' sheet targets; the
 * OAuth callback's outcome arrives as `?sheets=…`. `?view=catalogConnecting` still opens the purely
 * visual "Connecting…" state (see `lib/view-param.ts`).
 */
export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { user } = await requireSession();
  const card = await getIntegrationsCard(user.id, user.workspaceId, params);
  const view = readView(params.view, INTEGRATIONS_VIEWS, "catalog");

  return <IntegrationsCatalog key={view} card={card} view={view} />;
}

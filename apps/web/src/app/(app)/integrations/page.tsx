import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { SheetsPanel } from "@/components/integrations/sheets-panel";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { getIntegrationOverview } from "@/server/services/sheets-sync.service";

export const metadata: Metadata = { title: "Integrations" };

/**
 * Google Sheets integration.
 *
 * `/integrations` *is* this page rather than an index linking to it, because there is exactly one
 * integration — an index listing a single item is the picker-with-one-option this project has
 * rejected elsewhere.
 *
 * The shape follows how the feature actually works: **one Google connection at the top, then one
 * spreadsheet per website below it.** The customer authorises Google once; each website then points
 * at its own sheet, which is what an agency running several sites needs, and attaching one needs no
 * further consent screen.
 *
 * The read model makes no Google API calls, so the page — and in particular Disconnect — still works
 * when Google is unreachable or the grant has been revoked.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [overview, params] = await Promise.all([getIntegrationOverview(user.id), searchParams]);

  const flash = readFlash(params);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[18px]">
      <PageHeader
        title="Integrations"
        description="Send your experiment results somewhere else, automatically."
      />

      {flash ? (
        <div
          role={flash.tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-4 py-3",
            flash.tone === "error"
              ? "border-danger-border bg-danger-bg-2 text-danger-text"
              : "border-success-border bg-success-bg-2 text-success-strong",
          )}
        >
          <p className="text-[13.5px] font-extrabold">{flash.title}</p>
          <p className="mt-0.5 text-[13px]">{flash.body}</p>
        </div>
      ) : null}

      <SheetsPanel overview={overview} />
    </div>
  );
}

/** Turns the callback route's redirect codes into something a customer can read. */
function readFlash(
  params: Record<string, string | string[] | undefined>,
): { tone: "success" | "error"; title: string; body: string } | null {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  if (first("connected")) {
    return {
      tone: "success",
      title: "Google connected",
      body: "Now attach a spreadsheet to each website you want synced.",
    };
  }

  const error = first("error");
  if (!error) return null;

  const messages: Record<string, { title: string; body: string }> = {
    denied: {
      title: "Connection cancelled",
      body: "You cancelled on Google's screen, so nothing was connected.",
    },
    state: {
      title: "That connection attempt expired",
      body: "For your security the request is only valid for a few minutes. Please try again.",
    },
    invalid: {
      title: "Google's response was incomplete",
      body: "Please try connecting again.",
    },
    google: {
      title: "Google refused the request",
      body: "Please try again. If it keeps happening, check that this Google account has access to Google Sheets.",
    },
    not_configured: {
      title: "This integration is not configured",
      body: "Google OAuth credentials are missing on this deployment.",
    },
    connect: {
      title: "Could not finish connecting",
      body: first("detail") ?? "Please try again.",
    },
  };

  const message = messages[error] ?? { title: "Could not connect", body: "Please try again." };

  return { tone: "error", ...message };
}

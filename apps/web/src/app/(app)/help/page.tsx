import type { Metadata } from "next";
import { cookies } from "next/headers";

import { HelpGuides } from "@/components/help/guide-content";
import { HelpProgress } from "@/components/help/help-progress";
import { GUIDES } from "@/lib/guides";
import { GUIDE_HIDDEN_COOKIE, SHEETS_SKIPPED_COOKIE, showsChecklist } from "@/lib/onboarding";
import { requireSession } from "@/server/auth/session";
import { getChecklist } from "@/server/services/dashboard.service";

export const metadata: Metadata = { title: "Help & Guides" };

/**
 * Help & Guides (not in the design; built in its card style): the workspace's "Getting started"
 * progress, then every guide on one scrolling page with a contents list. Contextual help links
 * jump straight to a section (`guideHref`).
 */
export default async function HelpPage() {
  const { user } = await requireSession();
  const jar = await cookies();
  const hidden = jar.get(GUIDE_HIDDEN_COOKIE)?.value === "1";
  const { checklist, role } = await getChecklist(user.id, user.workspaceId, {
    sheetsSkipped: jar.get(SHEETS_SKIPPED_COOKIE)?.value === "1",
  });
  return (
    <div className="flex min-w-0 flex-col gap-6 leading-[1.45]">
      <header className="flex min-w-0 flex-col gap-1.5">
        <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.01em] text-[#111827]">
          Help &amp; Guides
        </h1>
        <p className="m-0 text-sm leading-[22px] text-[#4B5563]">
          Short, step-by-step guides. Scroll, or pick a topic on the right.
        </p>
      </header>
      <HelpProgress
        checklist={role === "VIEWER" ? null : checklist}
        hidden={hidden}
        onDashboard={showsChecklist(role, checklist, hidden)}
      />
      <HelpGuides guides={GUIDES} />
    </div>
  );
}

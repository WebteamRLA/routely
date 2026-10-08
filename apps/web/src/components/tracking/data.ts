import "server-only";

import type { InstallInfo } from "@/components/tracking/types";
import { env } from "@/env";
import { buildInstallSnippet } from "@/lib/snippet";
import type { ProjectSettings, ProjectSummary } from "@/lib/view-models";

/**
 * The GTM variant of the install: a Custom HTML tag that injects the same tracking tag. The SDK
 * finds its site id through `script[data-site-id]` when `document.currentScript` is null, which is
 * the case for a script a tag manager inserts.
 */
export function buildGtmSnippet(sdkUrl: string, publicSiteId: string): string {
  return `<script>
  (function(d){var s=d.createElement("script");s.src=${JSON.stringify(sdkUrl)};s.setAttribute("data-site-id",${JSON.stringify(publicSiteId)});d.head.insertBefore(s,d.head.firstChild);})(document);
</script>`;
}

/** Shapes an already-loaded project into `InstallInfo`. */
export function installInfoFor(project: ProjectSummary | ProjectSettings): InstallInfo {
  return {
    projectId: project.id,
    publicSiteId: project.publicSiteId,
    snippet: buildInstallSnippet({ sdkUrl: env.SDK_URL, publicSiteId: project.publicSiteId }),
    gtmSnippet: buildGtmSnippet(env.SDK_URL, project.publicSiteId),
    method: project.installMethod,
    installed: project.installed,
    pixelVerifiedAt: project.pixelVerifiedAt,
    receivingData: project.receivingData,
    protocol: project.protocol,
    domains: project.domains,
  };
}

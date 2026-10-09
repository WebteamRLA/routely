import "server-only";

import type { InstallInfo } from "@/components/tracking/types";
import { env } from "@/env";
import { buildInstallSnippet } from "@/lib/snippet";
import type { ProjectSettings, ProjectSummary } from "@/lib/view-models";

/** Shapes an already-loaded project into `InstallInfo`. */
export function installInfoFor(project: ProjectSummary | ProjectSettings): InstallInfo {
  return {
    projectId: project.id,
    publicSiteId: project.publicSiteId,
    snippet: buildInstallSnippet({ sdkUrl: env.SDK_URL, publicSiteId: project.publicSiteId }),
    installed: project.installed,
    pixelVerifiedAt: project.pixelVerifiedAt,
    receivingData: project.receivingData,
    protocol: project.protocol,
    domains: project.domains,
  };
}

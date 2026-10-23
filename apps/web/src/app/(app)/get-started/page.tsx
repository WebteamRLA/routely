import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

/** Pre-design onboarding page. The dashboard's first-project onboarding replaced it. */
export default function GetStartedPage() {
  redirect(routes.dashboard);
}

import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

/** Pre-design goals list. Each experiment's goal now lives on its own page. */
export default function MetricsPage() {
  redirect(routes.experiments.list);
}

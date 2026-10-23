import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

/** Pre-design goal page. The goal is part of the experiment's page now. */
export default async function MetricPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  redirect(routes.experiments.detail(experimentId));
}

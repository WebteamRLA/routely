import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

/** Pre-design experiment form. New experiments start in the design's Split URL wizard. */
export default async function NewExperimentPage({
  searchParams,
}: {
  searchParams: Promise<{ websiteId?: string }>;
}) {
  const { websiteId } = await searchParams;
  redirect(routes.experiments.wizard("SPLIT_URL", undefined, websiteId));
}

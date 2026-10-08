import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

/** Legacy route → the project's settings (the project layout does the ownership check). */
export default async function WebsiteRedirect({
  params,
}: {
  params: Promise<{ websiteId: string }>;
}) {
  const { websiteId } = await params;
  redirect(routes.project(websiteId).settings("project"));
}

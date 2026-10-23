import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

/** Pre-design website page. A website is a project now; its page is the project dashboard. */
export default async function WebsitePage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  redirect(routes.projects.detail(websiteId));
}

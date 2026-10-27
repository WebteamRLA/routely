import { redirect } from "next/navigation";

import { findGuide } from "@/lib/guides";
import { routes } from "@/lib/routes";

/** Guides used to have a page each; they are one page now. An old link lands on its section. */
export default async function GuideRedirect({ params }: { params: Promise<{ guide: string }> }) {
  const guide = findGuide((await params).guide);
  const first = guide?.sections[0]?.id;
  redirect(first ? `${routes.help.index}#${first}` : routes.help.index);
}

import { FlaskConical, Plug, Rocket, Target, type LucideIcon } from "lucide-react";

import { routes } from "@/lib/routes";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** When true the item is active only on an exact path match, not on descendants. */
  exact?: boolean;
}

/**
 * Shared by the desktop sidebar and the mobile drawer so the two can never disagree.
 *
 * No "Add website" entry: there is no standalone create page to link to — a website is added
 * from an `AddWebsiteDialog` popup wherever it's needed (Get started's empty state, the
 * experiment wizard's website step), not from a permanent nav slot for a one-off action.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: routes.getStarted, label: "Get started", icon: Rocket, exact: true },
  { href: routes.experiments.list, label: "Experiments", icon: FlaskConical, exact: true },
  { href: routes.metrics.list, label: "Metrics", icon: Target, exact: true },
  { href: routes.integrations, label: "Integrations", icon: Plug, exact: true },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

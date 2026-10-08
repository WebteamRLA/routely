import { routes } from "@/lib/routes";

export interface NavItem {
  href: string;
  label: string;
  /** Other path prefixes that should light this item up — the experiment wizard and detail
   * pages highlight "Experiments", as in the design. */
  also?: string[];
}

/**
 * Shared by the desktop sidebar and the mobile drawer so the two can never disagree.
 *
 * Ordered as the design's sidebar. "Dashboard" is the Get started page: the account's figures,
 * its websites and their install state. The design's "Manage projects" and "Settings" entries
 * have no counterpart yet — a website's settings live on its own page, reached from the
 * website menu above the nav.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: routes.getStarted, label: "Dashboard", also: ["/websites"] },
  { href: routes.experiments.list, label: "Experiments", also: ["/experiments/"] },
  { href: routes.metrics.list, label: "Metrics & goals", also: ["/metrics/"] },
  { href: routes.integrations, label: "Integrations" },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  return (item.also ?? []).some((prefix) => pathname.startsWith(prefix));
}

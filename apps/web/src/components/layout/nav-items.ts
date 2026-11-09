import type { ComponentType, SVGProps } from "react";

import {
  DashboardIcon,
  HelpIcon,
  IntegrationsIcon,
  MetricsIcon,
  ProjectsIcon,
  SettingsIcon,
} from "@/components/layout/nav-icons";
import { routes } from "@/lib/routes";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** When true the item is active only on an exact path match, not on descendants. */
  exact?: boolean;
  /** Other sections this item stands for, so their pages keep it lit. */
  alsoMatches?: string[];
}

/**
 * The design's navigation: its three primary items plus Metrics (not in the design, user
 * request 2026-11-09), and Settings in a "Workspace" group pinned above the account block.
 * Help & Guides (not in the design) sits in that group, above Settings.
 *
 * Metrics is the Event Library with a project switcher: where custom events are created.
 *
 * Experiments have no item of their own — an experiment belongs to a project, so its list,
 * results and creation wizards all light Projects.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: routes.dashboard, label: "Dashboard", icon: DashboardIcon, exact: true },
  {
    href: routes.projects.list,
    label: "Projects",
    icon: ProjectsIcon,
    alsoMatches: [routes.experiments.list],
  },
  { href: routes.metrics.list, label: "Metrics", icon: MetricsIcon },
  { href: routes.integrations, label: "Integrations", icon: IntegrationsIcon },
];

export const WORKSPACE_NAV: NavItem[] = [
  { href: routes.help.index, label: "Help & Guides", icon: HelpIcon },
  { href: routes.settings, label: "Settings", icon: SettingsIcon },
];

function matchesPrefix(prefix: string, pathname: string): boolean {
  // Segment-anchored, so a future `/projects-archive` would not light up Projects.
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return [item.href, ...(item.alsoMatches ?? [])].some((prefix) => matchesPrefix(prefix, pathname));
}

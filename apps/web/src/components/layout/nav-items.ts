import { routes } from "@/lib/routes";

export interface NavItem {
  label: string;
  href: string;
  active: boolean;
  /** Shown as a pill (Experiments and Manage projects only, as in the design). */
  count?: number;
}

/**
 * The design's WORKSPACE nav, in its order. Active rules (DESIGN.md §1.3): the wizard and the
 * experiment detail light up "Experiments"; Settings → Team is still "Settings". Without a
 * project only "Manage projects" exists.
 */
export function buildNav(
  pathname: string,
  projectId: string | null,
  counts: { experiments: number; projects: number },
): NavItem[] {
  const manage: NavItem = {
    label: "Manage projects",
    href: routes.projects,
    active: pathname === routes.projects || pathname.startsWith(`${routes.projects}/`),
    count: counts.projects,
  };
  if (!projectId) return [manage];

  const p = routes.project(projectId);
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return [
    { label: "Dashboard", href: p.dashboard, active: pathname === p.dashboard },
    {
      label: "Experiments",
      href: p.experiments(),
      active: under(p.experiments()),
      count: counts.experiments,
    },
    { label: "Metrics & goals", href: p.metrics(), active: under(p.metrics()) },
    { label: "Integrations", href: p.integrations(), active: under(p.integrations()) },
    manage,
    { label: "Settings", href: p.settings(), active: under(`${p.dashboard}/settings`) },
  ];
}

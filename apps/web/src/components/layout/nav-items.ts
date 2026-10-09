import { routes } from "@/lib/routes";

export interface NavItem {
  label: string;
  href: string;
  active: boolean;
  /** Shown as a pill (Experiments and Manage projects only, as in the design). */
  count?: number;
  /** Group label drawn above this item (WORKSPACE · DATA · CONFIG). */
  group?: string;
}

/**
 * The design's nav, in its order and groups (v2): WORKSPACE (Dashboard, Experiments), DATA
 * (Metrics & goals), CONFIG (Integrations, Manage projects, Settings). Active rules: the wizard
 * and the experiment detail light up "Experiments"; Settings → Team is still "Settings". Without
 * a project only "Manage projects" exists, under WORKSPACE.
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
  if (!projectId) return [{ ...manage, group: "WORKSPACE" }];

  const p = routes.project(projectId);
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return [
    { label: "Dashboard", href: p.dashboard, active: pathname === p.dashboard, group: "WORKSPACE" },
    {
      label: "Experiments",
      href: p.experiments(),
      active: under(p.experiments()),
      count: counts.experiments,
    },
    { label: "Metrics & goals", href: p.metrics(), active: under(p.metrics()), group: "DATA" },
    {
      label: "Integrations",
      href: p.integrations(),
      active: under(p.integrations()),
      group: "CONFIG",
    },
    manage,
    { label: "Settings", href: p.settings(), active: under(`${p.dashboard}/settings`) },
  ];
}

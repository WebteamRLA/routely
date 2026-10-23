/**
 * Project dashboard — the design's leftover mock values, kept only for the two dialogs that other
 * packages own and still read them as a fallback: the launch confirm (`launchInfo` for the
 * design's `?view=` states) and the Google Sheets dialog's mock copy (`GS_EMAIL`, `DRIVE_SHEETS`).
 *
 * The screen itself renders real data now: shapes and rules are in `lib/project-dashboard.ts`,
 * the data in `project-dashboard.service.ts`.
 */

import type { LaunchInfo } from "@/lib/project-dashboard";

export type { LaunchInfo, PdExperiment } from "@/lib/project-dashboard";

export function launchInfo(id: string): LaunchInfo {
  const F = "fernwoodsupply.com";
  const J = "journal.fernwoodsupply.com";
  const info: Record<string, LaunchInfo> = {
    e3: {
      page: `${F}/cart`,
      include: 100,
      targeting: "All visitors",
      goal: `${F}/checkout`,
      arms: [
        ["Control", "Original page", "50%"],
        ["Variant A", "2 saved changes", "50%"],
      ],
      changes: "Variant A has 2 saved changes",
    },
    n3: {
      page: `${J}/articles/gear-care-101`,
      include: 50,
      targeting: "Desktop and tablet",
      goal: `${J}/newsletter/thanks`,
      arms: [
        ["Control", "Original page", "50%"],
        ["Variant A", "1 saved change", "50%"],
      ],
      changes: "Variant A has 1 saved change",
    },
  };
  return (
    info[id] ?? {
      page: "",
      include: 100,
      targeting: "All visitors",
      goal: "",
      arms: [],
      changes: "",
    }
  );
}

export const GS_EMAIL = "alex@fernwoodsupply.com";

export interface DriveSheet {
  id: string;
  name: string;
  meta: string;
}

export const DRIVE_SHEETS: DriveSheet[] = [
  { id: "s1", name: "Fernwood — Client reporting", meta: "Edited Oct 12 · shared with 4 people" },
  { id: "s2", name: "Q4 experiment results", meta: "Edited Oct 9 · only you" },
  { id: "s3", name: "Marketing KPIs 2026", meta: "Edited Sep 30 · shared with 7 people" },
];

export type GsStatus = "none" | "waiting" | "error" | "connected";

export interface GsState {
  status: GsStatus;
  sheet: { id: string; name: string } | null;
  link: "none" | "linking" | "linked";
  lastSync: string;
}

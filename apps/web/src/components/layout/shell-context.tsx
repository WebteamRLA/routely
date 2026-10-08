"use client";

import { createContext, useContext } from "react";

import type { ShellProject } from "@/components/layout/types";

export interface ShellApi {
  /** Every project the user owns, archived included. */
  projects: ShellProject[];
  /** The project the shell's links point at (URL's project, else the last one, else first). */
  current: ShellProject | null;
  /** Remembers the project (cookie), navigates to its dashboard, toasts — via the wizard guard. */
  switchProject: (projectId: string) => void;
  /** Signs out — via the wizard guard. */
  logout: () => void;
  openCreateProject: () => void;
  openEditProject: (project: ShellProject) => void;
}

export const ShellContext = createContext<ShellApi | null>(null);

/** Shell actions for pages rendered inside the dashboard chrome (e.g. Manage projects). */
export function useShell(): ShellApi {
  const api = useContext(ShellContext);
  if (!api) throw new Error("useShell must be used inside <AppShell>");
  return api;
}

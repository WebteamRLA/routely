"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { InstallModal } from "@/components/tracking/install-modal";
import type { InstallInfo } from "@/components/tracking/types";

const OpenInstall = createContext<(() => void) | null>(null);

/**
 * Hosts the dashboard's install modal. The tracking pill, a row's "Install" button and the
 * "Routely snippet" integration all open it; closing refreshes the page so a snippet detected
 * meanwhile turns the pill to "Tracking live".
 */
export function DashboardInstallProvider({
  install,
  projectName,
  children,
}: {
  install: InstallInfo;
  projectName: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    router.refresh();
  }, [router]);
  const value = useMemo(() => show, [show]);

  return (
    <OpenInstall.Provider value={value}>
      {children}
      <InstallModal
        open={open}
        onClose={close}
        install={install}
        projectName={projectName}
        context="settings"
      />
    </OpenInstall.Provider>
  );
}

/** Opens the install modal (inside `DashboardInstallProvider`). */
export function useOpenInstall(): () => void {
  const open = useContext(OpenInstall);
  if (!open) throw new Error("useOpenInstall must be used inside <DashboardInstallProvider>");
  return open;
}

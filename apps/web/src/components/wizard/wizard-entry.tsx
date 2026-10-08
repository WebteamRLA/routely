"use client";

import dynamic from "next/dynamic";

import { WizardSkeleton } from "./wizard-skeleton";
import type { WizardProps } from "./wizard";

/**
 * Client-only mount: the wizard restores an in-progress draft from `sessionStorage` in its
 * initial state, which the server cannot see — rendering it on the server would only produce a
 * hydration mismatch after a refresh.
 */
const Wizard = dynamic(() => import("./wizard").then((m) => m.Wizard), {
  ssr: false,
  loading: () => <WizardSkeleton />,
});

export function WizardEntry(props: WizardProps) {
  return <Wizard {...props} />;
}

"use client";

import Link from "next/link";

import { useShell } from "@/components/layout/shell-context";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * "+ New experiment" → the wizard's Type step for the current project. With no project yet it
 * opens "Create new project" instead — an experiment always belongs to one.
 */
export function NewExperimentButton({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const { current, openCreateProject } = useShell();
  const cls = cn(
    "grid h-10 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-brand text-sm font-bold text-white no-underline outline-none hover:bg-[#3D69F5] hover:text-white hover:no-underline focus-visible:ring-3 focus-visible:ring-primary/40",
    className,
  );
  if (!current)
    return (
      <button
        type="button"
        className={cls}
        onClick={() => {
          onNavigate?.();
          openCreateProject();
        }}
      >
        + New experiment
      </button>
    );
  return (
    <Link href={routes.project(current.id).newExperiment()} onClick={onNavigate} className={cls}>
      + New experiment
    </Link>
  );
}

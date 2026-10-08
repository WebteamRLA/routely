import Link from "next/link";

import { routes } from "@/lib/routes";

/** The sidebar's primary action, shared by the desktop sidebar and the mobile drawer. */
export function NewExperimentButton({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href={routes.experiments.new()}
      onClick={onNavigate}
      className="grid h-10 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-white no-underline outline-none hover:bg-[#3D69F5] hover:text-white hover:no-underline focus-visible:ring-3 focus-visible:ring-primary/40"
    >
      + New experiment
    </Link>
  );
}

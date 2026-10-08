import Link from "next/link";

import { Eyebrow } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/** "Overview · last 14 days", the dynamic title/sub, and the two create buttons. */
export function DashboardHeader({
  projectId,
  title,
  sub,
}: {
  projectId: string;
  title: string;
  sub: string;
}) {
  const p = routes.project(projectId);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <Eyebrow>Overview · last 14 days</Eyebrow>
        <h1 className="mt-2 mb-1 font-heading text-[clamp(22px,2.4vw,26px)] font-bold tracking-[-0.02em] text-pretty">
          {title}
        </h1>
        <div className="text-sm text-pretty text-ink-3">{sub}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={p.newExperiment("redirect")}>New split URL test</Link>
        </Button>
        <Button asChild>
          <Link href={p.newExperiment("ab")}>New A/B test</Link>
        </Button>
      </div>
    </div>
  );
}

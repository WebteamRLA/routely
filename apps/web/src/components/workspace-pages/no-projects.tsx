import Link from "next/link";

import { btn, card } from "@/components/rt/styles";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** Metrics before the workspace has a project: events belong to one. */
export function NoProjects({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 text-[20px] leading-7 font-semibold tracking-[-0.01em] text-[#111827]">
        {title}
      </h1>
      <section className={cn(card, "flex flex-col items-center gap-3 px-6 py-12 text-center")}>
        <h2 className="m-0 text-[15px] leading-[22px] font-semibold text-[#111827]">
          No projects yet
        </h2>
        <p className="m-0 max-w-[420px] text-[14px] leading-5 text-pretty text-[#4B5563]">
          {children}
        </p>
        <Link href={routes.projects.list} className={cn(btn.primary, "no-underline")}>
          Go to Projects
        </Link>
      </section>
    </div>
  );
}

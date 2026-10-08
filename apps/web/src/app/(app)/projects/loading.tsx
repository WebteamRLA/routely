import { Section, Shimmer } from "@/components/rl";

/** Manage projects skeleton: header and three rows. */
export default function ProjectsLoading() {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Shimmer className="h-7 w-56 rounded-md" />
        <Shimmer className="h-4 w-[28rem] max-w-full rounded-sm" />
      </div>
      <Section as="div" className="flex flex-col gap-3 p-5">
        {[0, 1, 2].map((i) => (
          <Shimmer key={i} className="h-11" />
        ))}
      </Section>
    </div>
  );
}

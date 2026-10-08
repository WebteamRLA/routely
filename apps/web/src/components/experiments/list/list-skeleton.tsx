import { Section, Shimmer } from "@/components/rl";

/** Five shimmer rows of three bars (prototype L677–687). */
export function ListSkeleton() {
  return (
    <Section as="div" aria-busy="true" aria-label="Loading experiments" className="px-[18px] py-2">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-divider py-3.5 last:border-b-0"
        >
          <Shimmer className="h-3.5 flex-[2] rounded-sm" />
          <Shimmer className="h-3.5 flex-1 rounded-sm" />
          <Shimmer className="h-3.5 flex-1 rounded-sm" />
        </div>
      ))}
    </Section>
  );
}

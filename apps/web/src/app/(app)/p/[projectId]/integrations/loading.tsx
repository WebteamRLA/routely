import { Section, Shimmer } from "@/components/rl";

export default function IntegrationsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[18px]" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Shimmer className="h-7 w-40" />
        <Shimmer className="h-4 w-72" />
      </div>
      <Shimmer className="h-10 w-64" />
      <Section as="div" padded className="gap-4">
        <Shimmer className="h-5 w-56" />
        <Shimmer className="h-4 w-full max-w-[520px]" />
        <Shimmer className="h-[120px]" />
        <Shimmer className="h-[160px]" />
      </Section>
    </div>
  );
}

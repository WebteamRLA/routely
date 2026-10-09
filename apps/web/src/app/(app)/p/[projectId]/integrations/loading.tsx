import { Section, Shimmer } from "@/components/rl";
import { SettingsShellSkeleton } from "@/components/settings/settings-shell";

export default function IntegrationsLoading() {
  return (
    <SettingsShellSkeleton>
      <Section as="div" padded className="gap-4">
        <Shimmer className="h-5 w-56" />
        <Shimmer className="h-4 w-full max-w-[520px]" />
        <Shimmer className="h-[120px]" />
        <Shimmer className="h-[160px]" />
      </Section>
    </SettingsShellSkeleton>
  );
}

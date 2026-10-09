import { Shimmer } from "@/components/rl";
import { SettingsShellSkeleton } from "@/components/settings/settings-shell";

export default function SettingsLoading() {
  return (
    <SettingsShellSkeleton>
      <Shimmer className="h-[260px]" />
      <Shimmer className="h-[180px]" />
    </SettingsShellSkeleton>
  );
}

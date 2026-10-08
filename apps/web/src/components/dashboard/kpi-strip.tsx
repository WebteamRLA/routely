import type { KpiView } from "@/components/dashboard/model";
import { KpiStrip, KpiTile } from "@/components/rl";

/** The four KPI tiles; each opens the experiments list filtered or sorted to match. */
export function DashboardKpis({ tiles }: { tiles: KpiView[] }) {
  return (
    <KpiStrip>
      {tiles.map((k) => (
        <KpiTile
          key={k.label}
          href={k.href}
          label={k.label}
          value={k.value}
          delta={k.delta}
          deltaColor={k.deltaColor}
          sub={k.sub}
        />
      ))}
    </KpiStrip>
  );
}

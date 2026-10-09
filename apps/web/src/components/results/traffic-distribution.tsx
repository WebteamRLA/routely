import { CardTitle, Section, TrafficBar } from "@/components/rl";
import { fP } from "@/lib/format";
import type { ArmStat } from "@/lib/stats";

/** Actual visitors per arm vs the planned split, with a sample-ratio check. */
export function TrafficDistribution({
  arms,
  totalVisitors,
  coverage,
}: {
  arms: ArmStat[];
  totalVisitors: number;
  coverage: number;
}) {
  const srm = totalVisitors
    ? arms.some((a) => Math.abs(a.v / totalVisitors - (a.weight ?? 0) / 100) > 0.03)
    : false;
  return (
    <Section className="flex flex-col gap-3.5 p-[18px]">
      <CardTitle>Traffic distribution</CardTitle>
      <div>
        <div className="mb-1.5 text-[12px] font-bold text-ink-3">Actual visitors</div>
        <TrafficBar
          size="xl"
          segments={arms.map((a) => {
            const share = totalVisitors ? a.v / totalVisitors : 0;
            return {
              weight: share * 100,
              color: a.color,
              label:
                share > 0.12
                  ? `${a.i ? a.name.replace("Variant ", "") : "Control"} ${fP(share, 1)}`
                  : "",
            };
          })}
        />
      </div>
      <div>
        <div className="mb-1.5 text-[12px] font-bold text-ink-3">
          Planned {arms.map((a) => `${a.weight ?? 0}%`).join(" / ")} · {coverage}% of matching
          visitors
        </div>
        <TrafficBar
          size="sm"
          faded
          segments={arms.map((a) => ({ weight: a.weight ?? 0, position: a.i }))}
        />
      </div>
      <div className="text-[12.5px] font-bold" style={{ color: srm ? "#94600A" : "#0F7A52" }}>
        {srm
          ? "Actual split differs from plan by more than 3 points. Check for redirect errors."
          : "Actual split matches the plan. No sample ratio mismatch."}
      </div>
    </Section>
  );
}

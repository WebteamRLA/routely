"use client";

import { PillToggle, Segmented } from "@/components/rl";
import type { CountingKey } from "@/lib/domain";

const COUNTING: { value: CountingKey; label: string }[] = [
  { value: "unique", label: "Once per visitor" },
  { value: "all", label: "Every conversion" },
];

/** "Count conversions": once per visitor / every conversion (wizard Goals step, live edit). */
export function CountingControl({
  value,
  onChange,
}: {
  value: CountingKey;
  onChange: (value: CountingKey) => void;
}) {
  return (
    <Segmented ariaLabel="Count conversions" options={COUNTING} value={value} onChange={onChange} />
  );
}

/** Secondary-goal pills ("✓ name" / "+ name"); toggling returns the new id list. */
export function SecondaryGoalPills({
  metrics,
  selected,
  onChange,
}: {
  metrics: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {metrics.map((m) => {
        const on = selected.includes(m.id);
        return (
          <PillToggle
            key={m.id}
            on={on}
            onClick={() =>
              onChange(on ? selected.filter((id) => id !== m.id) : [...selected, m.id])
            }
          >
            {m.name}
          </PillToggle>
        );
      })}
    </div>
  );
}

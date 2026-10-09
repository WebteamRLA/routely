"use client";

import { Segmented } from "@/components/rl";
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

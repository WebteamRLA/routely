import type { CountingKey } from "@/lib/domain";
import type { ExperimentDetail } from "@/lib/view-models";

/**
 * What can still change once an experiment has started (a subset of the service's `editLive`):
 * name, hypothesis, the traffic split, coverage and counting. URLs, A/B changes, targeting and
 * the goal are fixed — visitors are already bucketed. Design v2 retired secondary goals, so the
 * edit never sends `secondary`: the service then leaves an older experiment's list untouched.
 */
export interface LiveEdit {
  name: string;
  hypothesis: string;
  arms: { name: string; weight: number }[];
  coverage: number;
  counting: CountingKey;
}

export function liveEditFrom(detail: ExperimentDetail): LiveEdit {
  return {
    name: detail.name,
    hypothesis: detail.hypothesis,
    arms: [...detail.arms]
      .sort((a, b) => a.position - b.position)
      .map((a) => ({ name: a.name, weight: a.weight })),
    coverage: detail.coverage,
    counting: detail.counting,
  };
}

/** Only the fields that differ from the saved experiment, so the activity log stays honest. */
export function liveEditChanges(
  detail: ExperimentDetail,
  edit: LiveEdit,
): Partial<{
  name: string;
  hypothesis: string;
  weights: number[];
  coverage: number;
  counting: CountingKey;
}> {
  const saved = liveEditFrom(detail);
  const out: ReturnType<typeof liveEditChanges> = {};
  if (edit.name.trim() !== saved.name) out.name = edit.name.trim();
  if (edit.hypothesis.trim() !== saved.hypothesis.trim()) out.hypothesis = edit.hypothesis.trim();
  const weights = edit.arms.map((a) => a.weight);
  if (weights.some((w, i) => w !== saved.arms[i]?.weight)) out.weights = weights;
  if (edit.coverage !== saved.coverage) out.coverage = edit.coverage;
  if (edit.counting !== saved.counting) out.counting = edit.counting;
  return out;
}

/** Server field-error keys → the edit section that shows them. */
export function editError(
  fieldErrors: Record<string, string[]> | undefined,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const first = fieldErrors?.[key]?.[0];
    if (first) return first;
  }
  return null;
}

import type { ExperimentStatusKey } from "@/lib/domain";
import { fDate, fDateY } from "@/lib/format";

/** Project-local `YYYY-MM-DD` for a timestamp. */
export function dayKey(value: string | Date, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone });
}

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * The header's timing text (prototype `dx.timing`): "Draft · created Oct 6, 2026",
 * "Running for 18 days · started Sep 21", "Launched today", "Paused · ran 6 days",
 * "Ran 21 days · ended Oct 2, 2026".
 */
export function timingText(
  e: {
    status: ExperimentStatusKey;
    createdAt?: string | null;
    publishedAt: string | null;
    stoppedAt: string | null;
    updatedAt?: string | null;
  },
  timeZone: string,
  now: Date = new Date(),
): string {
  if (e.status === "draft") return `Draft · created ${fDateY(e.createdAt ?? now, timeZone)}`;
  const end = e.status === "completed" && e.stoppedAt ? new Date(e.stoppedAt) : now;
  const days = e.publishedAt
    ? Math.max(1, Math.ceil((end.getTime() - new Date(e.publishedAt).getTime()) / 86_400_000))
    : 0;
  if (e.status === "completed") {
    return `Ran ${plural(days)} · ended ${fDateY(e.stoppedAt ?? e.updatedAt ?? now, timeZone)}`;
  }
  if (e.status === "paused") return `Paused · ran ${plural(days)}`;
  if (!e.publishedAt || dayKey(e.publishedAt, timeZone) === dayKey(now, timeZone)) {
    return "Launched today";
  }
  return `Running for ${plural(days)} · started ${fDate(e.publishedAt, timeZone)}`;
}

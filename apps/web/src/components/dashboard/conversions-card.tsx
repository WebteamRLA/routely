import type { ConversionSlice } from "@/components/dashboard/model";
import { fN, fP } from "@/lib/format";

const COLS = 26;
const ROWS = 14;
const GAP = 10.5;
const R = 4.4;
const EMPTY = "#EEF0F4";

/**
 * Shares the grid's dots out to the slices by largest remainder, so the dots always add up to
 * the whole grid and every slice with a conversion gets at least one dot.
 */
function allocate(slices: ConversionSlice[], dots: number): string[] {
  const total = slices.reduce((t, s) => t + s.conversions, 0);
  if (!total) return Array<string>(dots).fill(EMPTY);
  const exact = slices.map((s) => (s.conversions / total) * dots);
  const counts = exact.map((x, i) => Math.max(slices[i]!.conversions > 0 ? 1 : 0, Math.floor(x)));
  let left = dots - counts.reduce((t, n) => t + n, 0);
  const order = exact.map((x, i) => ({ i, rem: x - Math.floor(x) })).sort((a, b) => b.rem - a.rem);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--)
    counts[order[k]!.i]! += 1;
  for (let k = order.length - 1; left < 0 && k >= 0; k--) {
    const i = order[k]!.i;
    if (counts[i]! > 1) {
      counts[i]! -= 1;
      left++;
    }
  }
  return slices.flatMap((s, i) => Array<string>(counts[i]!).fill(s.color));
}

/**
 * "Conversions by running experiment": the total, a honeycomb of dots split between the running
 * experiments in proportion to their primary-goal conversions, and a legend with each count.
 */
export function ConversionsCard({ slices }: { slices: ConversionSlice[] }) {
  const total = slices.reduce((t, s) => t + s.conversions, 0);
  const colors = allocate(slices, COLS * ROWS);
  const width = COLS * GAP + GAP / 2;
  const height = ROWS * GAP * 0.9 + GAP * 0.2;

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card px-5 pt-5 pb-4 shadow-[0_1px_2px_rgba(10,22,51,0.04)]">
      <h2 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">
        Conversions by running experiment
      </h2>
      <div className="mt-2 font-heading text-[26px] leading-none font-bold tracking-[-0.02em] tabular-nums">
        {fN(total)}
      </div>
      <div className="text-right text-xs text-ink-3">Primary goals · all time</div>

      <div className="flex flex-1 items-center justify-center py-5">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full max-w-[280px]"
          role="img"
          aria-label={
            total
              ? slices.map((s) => `${s.name}: ${s.conversions} conversions`).join(", ")
              : "No conversions recorded yet"
          }
        >
          {colors.map((color, i) => {
            const row = Math.floor(i / COLS);
            const col = i % COLS;
            const cx = GAP / 2 + col * GAP + (row % 2 ? GAP / 2 : 0);
            const cy = GAP / 2 + row * GAP * 0.9;
            return <circle key={i} cx={cx} cy={cy} r={R} fill={color} />;
          })}
        </svg>
      </div>

      <div className="border-t border-divider pt-3">
        {total ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {slices.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5 text-[13px]">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                <span className="font-bold tabular-nums">{fN(s.conversions)}</span>
                <span className="w-12 text-right text-ink-3 tabular-nums">
                  {fP(s.conversions / total, 0)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-1 text-center text-[13px] text-ink-3">
            {slices.length ? "No conversions recorded yet." : "No experiment is running."}
          </p>
        )}
      </div>
    </section>
  );
}

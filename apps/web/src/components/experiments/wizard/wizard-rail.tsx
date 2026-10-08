import {
  armColorClass,
  displayPath,
  type WizardValues,
  type WizardWebsite,
} from "@/components/experiments/wizard/wizard-types";
import { cn } from "@/lib/utils";

/**
 * The desktop summary rail beside the wizard: a live read-out of what has been entered so far,
 * so the customer never has to step back to remember what they typed three steps ago. Purely a
 * view of the wizard's state — it holds nothing of its own.
 */
export function WizardRail({
  values,
  website,
  shares,
  className,
}: {
  values: WizardValues;
  website: WizardWebsite | undefined;
  /** Each arm's share of total traffic, control first, plus the share left out. */
  shares: { control: number; variants: number[]; excluded: number };
  className?: string;
}) {
  const arms = [
    { name: "Control", url: values.controlUrl, percent: shares.control },
    ...values.variants.map((variant, index) => ({
      name: `Variant ${index + 1}`,
      url: variant.url,
      percent: shares.variants[index] ?? 0,
    })),
  ];
  const controlPath = displayPath(values.controlUrl);
  const goalPath = displayPath(values.conversionUrl);

  return (
    <aside
      aria-label="Experiment summary"
      className={cn(
        "sticky top-6 flex w-[290px] flex-none flex-col gap-3.5 rounded-lg border border-border bg-card p-[18px]",
        className,
      )}
    >
      <p className="text-[11px] font-extrabold tracking-[0.1em] text-ink-3">SUMMARY</p>

      <div className="min-w-0">
        <p className="font-heading text-[15px] font-semibold break-words">
          {values.name || <span className="text-faint">Untitled experiment</span>}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
          {website ? website.name : "Split URL test"}
          {controlPath ? (
            <>
              {" · "}
              <span className="font-mono">{controlPath}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]" aria-hidden>
        {arms.map((arm, index) =>
          arm.percent > 0 ? (
            <div
              key={arm.name}
              className={armColorClass(index)}
              style={{ flexGrow: arm.percent, flexBasis: 0 }}
            />
          ) : null,
        )}
        {shares.excluded > 0 ? (
          <div className="bg-divider" style={{ flexGrow: shares.excluded, flexBasis: 0 }} />
        ) : null}
      </div>

      <ul className="flex flex-col gap-2">
        {arms.map((arm, index) => {
          const path = displayPath(arm.url);
          return (
            <li key={arm.name} className="flex items-center gap-2 text-[13px]">
              <span
                aria-hidden
                className={cn("size-2 flex-none rounded-[2px]", armColorClass(index))}
              />
              <span className="flex-none font-bold">{arm.name}</span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[11.5px]",
                  path ? "font-mono text-ink-3" : "font-semibold text-faint",
                )}
              >
                {path || "Not set"}
              </span>
              <span className="flex-none font-extrabold tabular-nums">{arm.percent}%</span>
            </li>
          );
        })}
      </ul>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-divider pt-3 text-[13px]">
        <dt className="text-ink-3">Goal</dt>
        <dd className={cn("truncate font-bold", goalPath && "font-mono text-xs leading-5")}>
          {goalPath || <span className="font-sans text-faint">Not set</span>}
        </dd>
        <dt className="text-ink-3">Audience</dt>
        <dd className="font-bold">All visitors</dd>
        <dt className="text-ink-3">Included</dt>
        <dd className="font-bold tabular-nums">{values.trafficAllocation}% of traffic</dd>
      </dl>
    </aside>
  );
}

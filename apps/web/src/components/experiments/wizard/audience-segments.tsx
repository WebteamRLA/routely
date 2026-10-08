import { WizardSection } from "@/components/experiments/wizard/wizard-step-card";
import { displayPath } from "@/components/experiments/wizard/wizard-types";
import type { UrlMatchType } from "@/generated/prisma/enums";

/**
 * Who an experiment is shown to.
 *
 * Every experiment runs against all visitors. A list of preset segments — device type, new vs
 * returning, paid/organic/social traffic — sat here marked "Coming soon" until it was removed:
 * each needs a signal Routely does not collect (the SDK never sends device type or referrer,
 * and "new vs returning" needs a visitor's history read before the config request resolves),
 * so the list advertised seven things the product cannot do.
 *
 * The page row is read-only: it restates the control URL entered earlier and how it is matched,
 * which is what actually decides who can enter. The match type has no control in the wizard;
 * it is editable on the experiment's own page.
 */
export function AudienceSegments({
  controlUrl,
  controlMatchType,
}: {
  controlUrl: string;
  controlMatchType: UrlMatchType;
}) {
  const path = displayPath(controlUrl);

  return (
    <WizardSection padded={false}>
      <div className="flex flex-wrap items-baseline justify-between gap-2.5 border-b border-divider px-5 py-4">
        <h3 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">Audience</h3>
        <span className="text-[12.5px] text-ink-3">No rules</span>
      </div>

      <div className="flex items-center gap-3 border-b border-divider px-5 py-4">
        <span
          aria-hidden
          className="grid size-[22px] flex-none place-items-center rounded-full bg-success-bg text-xs font-black text-success-text"
        >
          ✓
        </span>
        <div className="min-w-0">
          <p className="font-extrabold">All visitors</p>
          <p className="mt-px text-[13px] text-ink-3">
            All the visitors reaching your website, on any device. Known bots are never counted.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-5 py-3.5">
        <div className="flex-[0_0_150px]">
          <p className="text-[13.5px] font-extrabold">Page</p>
          <p className="mt-0.5 text-xs text-ink-3">
            {controlMatchType === "PREFIX" ? "URL starts with" : "Exact URL"}
          </p>
        </div>
        <p className="min-w-0 flex-[1_1_240px] pt-0.5 font-mono text-[13px] break-all">
          {path || <span className="font-sans text-faint">Set the control URL first</span>}
        </p>
      </div>
    </WizardSection>
  );
}

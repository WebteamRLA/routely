"use client";

import { ArmSwatch, RadioCard, RadioDot } from "@/components/rl";
import { setDraftType } from "@/lib/validate-draft";

import type { StepProps } from "./types";
import { StepHeading } from "./ui";

const CARD = "flex flex-col gap-3.5 p-5";

/** Step 1 — Type (design L816–839). */
export function StepType({ draft, update }: Pick<StepProps, "draft" | "update">) {
  const R = draft.type === "redirect";
  return (
    <>
      <StepHeading title="What kind of experiment?">
        Both split traffic and measure conversions. The difference is where the variant lives.
      </StepHeading>
      <div
        role="radiogroup"
        aria-label="Experiment type"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3.5"
      >
        <RadioCard
          selected={R}
          onSelect={() => update((d) => setDraftType(d, "redirect"))}
          className={CARD}
        >
          <div className="flex items-center justify-between">
            <span className="font-heading text-lg font-semibold">Split URL test</span>
            <RadioDot on={R} size={18} className="mt-0.5" />
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-muted p-3.5 font-mono text-xs">
            <div className="flex items-center gap-2">
              <ArmSwatch position={0} size={8} />
              /landing-page<span className="ml-auto text-ink-3">50%</span>
            </div>
            <div className="flex items-center gap-2">
              <ArmSwatch position={1} size={8} />
              /new-landing-page<span className="ml-auto text-ink-3">50%</span>
            </div>
          </div>
          <div className="text-[13.5px] leading-[1.55] text-ink-2">
            Redirect visitors between two or more <b>different URLs</b>. Best for redesigns, new
            templates or whole new funnels built elsewhere.
          </div>
        </RadioCard>
        <RadioCard
          selected={!R}
          onSelect={() => update((d) => setDraftType(d, "ab"))}
          className={CARD}
        >
          <div className="flex items-center justify-between">
            <span className="font-heading text-lg font-semibold">A/B test</span>
            <RadioDot on={!R} size={18} className="mt-0.5" />
          </div>
          <div className="flex gap-2 rounded-lg bg-muted p-3.5 text-xs">
            <div className="flex-1 rounded-md border border-border bg-white p-2">
              <div className="font-extrabold">Buy now</div>
              <div className="mt-0.5 text-ink-3">Control</div>
            </div>
            <div className="flex-1 rounded-md border border-brand bg-white p-2">
              <div className="font-extrabold text-brand">Get 20% off</div>
              <div className="mt-0.5 text-ink-3">Variant A</div>
            </div>
          </div>
          <div className="text-[13.5px] leading-[1.55] text-ink-2">
            Keep the <b>same URL</b> and change text, images or buttons in the visual editor. Best
            for copy, offers and CTA tests.
          </div>
        </RadioCard>
      </div>
    </>
  );
}

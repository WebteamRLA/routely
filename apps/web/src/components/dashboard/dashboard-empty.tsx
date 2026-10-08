import Link from "next/link";

import { Section } from "@/components/rl";
import { routes } from "@/lib/routes";

export interface OnboardingStep {
  title: string;
  body: string;
  done: boolean;
}

/**
 * The first-run dashboard: the navy welcome hero with the two test types, then the three
 * onboarding steps. A step's circle turns green once it is really done (snippet detected, a
 * metric exists) — the prototype's static colours would otherwise claim progress that hasn't
 * happened.
 */
export function DashboardEmpty({
  projectId,
  steps,
}: {
  projectId: string;
  steps: OnboardingStep[];
}) {
  const p = routes.project(projectId);
  const option =
    "block rounded-lg border border-white/14 bg-white/5 p-[18px] text-left text-white no-underline hover:bg-white/10 hover:text-white hover:no-underline";
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-center gap-7 rounded-xl bg-navy p-[clamp(24px,4vw,44px)] text-white">
        <div>
          <div className="text-xs font-extrabold tracking-[0.1em] text-coral">
            WELCOME TO ROUTELY
          </div>
          <div className="mt-2.5 mb-3 font-heading text-[clamp(22px,2.6vw,30px)] leading-[1.15] font-bold tracking-[-0.02em] text-pretty">
            Stop guessing. Split your traffic and let visitors pick the winner.
          </div>
          <div className="max-w-[480px] leading-relaxed text-white/72">
            Install the snippet, choose what you want to test, and Routely handles assignment,
            tracking and the maths.
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <Link href={p.newExperiment("redirect")} className={option}>
            <div className="font-heading text-base font-semibold">Split URL test →</div>
            <div className="mt-1 text-[13.5px] text-white/70">
              Send traffic between two different pages, e.g. a redesign.
            </div>
          </Link>
          <Link href={p.newExperiment("ab")} className={option}>
            <div className="font-heading text-base font-semibold">A/B test →</div>
            <div className="mt-1 text-[13.5px] text-white/70">
              Change copy, images or buttons on one page with the visual editor.
            </div>
          </Link>
        </div>
      </div>
      <Section
        as="div"
        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-[18px] p-[22px]"
      >
        {steps.map((s, i) => (
          <div key={s.title} className="flex gap-3">
            <div
              className="grid size-[26px] shrink-0 place-items-center rounded-full text-xs font-extrabold"
              style={
                s.done
                  ? { background: "#E6F5EE", color: "#0F7A52" }
                  : { background: "#EEF0F4", color: "#4B5568" }
              }
            >
              {s.done ? "✓" : i + 1}
            </div>
            <div>
              <div className="font-bold">{s.title}</div>
              <div className="mt-0.5 text-[13px] text-ink-3">{s.body}</div>
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}

import { BrandMark } from "@/components/layout/brand";
import { cn } from "@/lib/utils";

/**
 * The navy panel beside the sign-in form on wide screens.
 *
 * Its job is to answer "what is this?" for someone who has landed on the login screen cold —
 * an invite link, a bookmark, a teammate's forward — without making them go and find the
 * marketing site first.
 *
 * The split bar at the foot is the product in one picture: one URL's traffic divided between
 * two pages. It is decorative (`aria-hidden`); the headline and subcopy carry the meaning. It
 * deliberately shows no results figures, so the login screen cannot promise a confidence claim
 * the results UI does not make.
 */
export function AuthShowcase({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "min-h-screen flex-[1_1_50%] flex-col justify-between gap-10 bg-navy px-[clamp(32px,5vw,64px)] py-11 text-white",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <span className="font-heading text-xl font-bold tracking-[-0.01em]">Routely</span>
      </div>

      <div className="max-w-[480px]">
        <p className="flex items-center gap-2 text-[11.5px] font-extrabold tracking-[0.14em] text-coral">
          <span aria-hidden className="size-[7px] rotate-45 bg-coral" />
          EXPERIMENTATION FOR GROWTH TEAMS
        </p>
        <h2 className="my-4 font-heading text-[clamp(32px,3.6vw,46px)] leading-[1.06] font-bold tracking-[-0.03em]">
          Run experiments.
          <br />
          Learn what converts.
        </h2>
        <p className="text-[15.5px] leading-relaxed text-white/72">
          Split traffic between two URLs, track conversions on both, and see in plain language which
          one is ahead.
        </p>
      </div>

      <div aria-hidden className="flex max-w-[480px] flex-col gap-2">
        <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-[5px]">
          <div className="flex-[50] bg-arm-control" />
          <div className="flex-[50] bg-arm-a" />
        </div>
        <div className="flex justify-between font-mono text-xs text-white/60">
          <span>/pricing · 50%</span>
          <span>/pricing-b · 50%</span>
        </div>
      </div>
    </aside>
  );
}

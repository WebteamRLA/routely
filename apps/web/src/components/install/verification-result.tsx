import { HelpLink } from "@/components/common/help-link";
import { Spinner, WarningIcon } from "@/components/rt/icons";
import { ACCENT, ACCENT_INK, ACCENT_TINT } from "@/components/rt/styles";
import type { VerifyOutcome } from "@/lib/install-verification";

import { type VerifyTone, verifyTone } from "./verification-state";

const TONES: Record<
  VerifyTone,
  {
    label: string;
    ink: string;
    bg: string;
    border: string;
    pillBg: string;
    pillFg: string;
    dot: string;
  }
> = {
  running: {
    label: "Checking",
    ink: "#111827",
    bg: "#FAFBFC",
    border: "#E5E7EB",
    pillBg: ACCENT_TINT,
    pillFg: ACCENT_INK,
    dot: ACCENT,
  },
  ok: {
    label: "Verified",
    ink: "#166534",
    bg: "#ECFDF5",
    border: "#BBF7D0",
    pillBg: "#DCFCE7",
    pillFg: "#166534",
    dot: "#16A34A",
  },
  warn: {
    label: "Not verified",
    ink: "#92400E",
    bg: "#FFFBEB",
    border: "#FDE68A",
    pillBg: "#FEF3C7",
    pillFg: "#92400E",
    dot: "#D97706",
  },
  fail: {
    label: "Not verified",
    ink: "#B91C1C",
    bg: "#FEF2F2",
    border: "#FECACA",
    pillBg: "#FEE2E2",
    pillFg: "#B91C1C",
    dot: "#DC2626",
  },
};

/** One check's answer. All of its words come from `lib/install-verification.ts`. */
export function VerificationResult({
  outcome,
  blockedUrl,
}: {
  outcome: VerifyOutcome;
  blockedUrl: string | null;
}) {
  const tone = verifyTone(outcome);
  const t = TONES[tone];
  const moreFixes = outcome.status === "not_installed" || outcome.status === "sdk_failed_to_load";

  return (
    <section
      aria-labelledby="rt-pm-vs"
      role="status"
      className="flex flex-col overflow-hidden rounded-xl border bg-white"
      style={{ borderColor: t.border }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-3"
        style={{ background: t.bg, borderColor: t.border }}
      >
        <h3
          id="rt-pm-vs"
          className="m-0 flex items-center gap-2 text-[14px] leading-5 font-semibold [overflow-wrap:anywhere]"
          style={{ color: t.ink }}
        >
          {tone === "running" ? <Spinner size={14} className="flex-none" /> : null}
          {outcome.title}
        </h3>
        <span
          className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold whitespace-nowrap"
          style={{ background: t.pillBg, color: t.pillFg }}
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full"
            style={{ background: t.dot }}
          />
          {t.label}
        </span>
      </div>

      <div className="flex flex-col gap-2.5 px-4 py-3">
        <p className="m-0 text-[14px] leading-5 text-pretty [overflow-wrap:anywhere] text-[#374151]">
          {outcome.detail}
        </p>
        {blockedUrl ? <BlockedTab url={blockedUrl} final={outcome.final} /> : null}
        {outcome.steps.length > 0 ? (
          <ol className="m-0 flex list-decimal flex-col gap-1 py-0 pr-0 pl-[18px] text-[13px] leading-[19px] text-[#374151]">
            {outcome.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
        {moreFixes ? (
          <HelpLink anchor="tracking-not-found" newTab>
            More fixes for a missing pixel
          </HelpLink>
        ) : null}
      </div>

      {outcome.warnings.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 border-t border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5">
          {outcome.warnings.map((warning) => (
            <li
              key={warning}
              className="flex items-start gap-2 text-[13px] leading-[19px] text-[#92400E]"
            >
              <WarningIcon size={14} className="mt-[2.5px] flex-none" />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Without a tab the SDK can't answer, so a failure here may only mean the page never opened. */
function BlockedTab({ url, final }: { url: string; final: boolean }) {
  return (
    <p className="m-0 rounded-lg bg-[#FFFBEB] px-3 py-2 text-[13px] leading-[19px] text-[#92400E]">
      {final ? (
        "Your browser blocked the new tab, so this result may be wrong. Allow pop-ups for this site, then check again."
      ) : (
        <>
          Your browser blocked the new tab.{" "}
          <a href={url} target="_blank" rel="opener" className="font-semibold underline">
            Open the page
          </a>{" "}
          so the check can run.
        </>
      )}
    </p>
  );
}

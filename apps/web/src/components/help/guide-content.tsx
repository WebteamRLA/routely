import Link from "next/link";

import { CheckIcon, InfoIcon, WarningIcon } from "@/components/rt/icons";
import { card, focusRing } from "@/components/rt/styles";
import { Rich } from "@/components/help/rich";
import { Screenshot } from "@/components/help/screenshot";
import type { Block, Guide, WalkStep } from "@/lib/guides-types";
import { cn } from "@/lib/utils";

/**
 * Renders every guide (`lib/guides.ts`) on one scrolling page — plain data, no HTML, so content
 * can't inject markup and the same blocks always look the same. Server component.
 */

/** Numbered steps, all visible; a step's screenshot (if any) sits under it. */
function StepList({ steps }: { steps: readonly WalkStep[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-4 p-0">
      {steps.map((step, i) => (
        <li key={step.title} className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-px inline-flex size-6 flex-[0_0_24px] items-center justify-center rounded-full bg-[#0070C9] text-xs font-semibold text-white tabular-nums"
          >
            {i + 1}
          </span>
          <div className="flex min-w-0 flex-auto flex-col gap-2">
            <p className="m-0 text-sm leading-[22px] text-pretty text-[#374151]">
              <span className="font-semibold text-[#111827]">{step.title}.</span>{" "}
              <Rich text={step.text} />
            </p>
            {step.shot ? <Screenshot shot={step.shot} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

const NOTE = {
  info: { bg: "#F0F7FF", border: "#B3DBFF", fg: "#0060AD", Icon: InfoIcon },
  tip: { bg: "#F0FDF4", border: "#BBF7D0", fg: "#166534", Icon: CheckIcon },
  warn: { bg: "#FFFBEB", border: "#FDE68A", fg: "#92400E", Icon: WarningIcon },
};

function BlockView({ block }: { block: Block }) {
  const P = "m-0 text-sm leading-[22px] text-pretty text-[#374151]";
  switch (block.kind) {
    case "p":
      return (
        <p className={P}>
          <Rich text={block.text} />
        </p>
      );
    case "shot":
      return <Screenshot shot={block.shot} caption={block.caption} />;
    case "walkthrough":
      return <StepList steps={block.steps} />;
    case "steps":
      return (
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-px inline-flex size-[22px] flex-[0_0_22px] items-center justify-center rounded-full bg-[#E6F4FF] text-xs font-semibold text-[#0060AD] tabular-nums"
              >
                {i + 1}
              </span>
              <span className={P}>
                <span className="sr-only">Step {i + 1}: </span>
                <Rich text={item} />
              </span>
            </li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 marker:text-[#9CA3AF]">
          {block.items.map((item, i) => (
            <li key={i} className={P}>
              <Rich text={item} />
            </li>
          ))}
        </ul>
      );
    case "note": {
      const t = NOTE[block.tone];
      return (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-lg border px-3.5 py-3"
          style={{ background: t.bg, borderColor: t.border }}
        >
          <t.Icon size={16} className="mt-[3px] flex-none" style={{ color: t.fg }} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm leading-[22px] font-semibold" style={{ color: t.fg }}>
              {block.title}
            </span>
            <span className={P}>
              <Rich text={block.text} />
            </span>
          </div>
        </div>
      );
    }
    case "code":
      return (
        <figure className="m-0 flex flex-col gap-1.5">
          <figcaption className="text-xs leading-4 font-medium text-[#6B7280]">
            {block.label}
          </figcaption>
          <pre className="m-0 overflow-x-auto rounded-lg bg-[#111827] px-4 py-3 font-mono text-[12.5px] leading-5 text-[#E5E7EB]">
            {block.code}
          </pre>
        </figure>
      );
    case "example":
      return (
        <div className="flex flex-col gap-2 rounded-lg border border-[#EEF0F3] bg-[#FAFBFC] px-4 py-3.5">
          <span className="text-xs leading-4 font-semibold tracking-[0.04em] text-[#6B7280] uppercase">
            Example · {block.title}
          </span>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 marker:text-[#9CA3AF]">
            {block.items.map((item, i) => (
              <li key={i} className={P}>
                <Rich text={item} />
              </li>
            ))}
          </ul>
        </div>
      );
    case "faq":
      return (
        <div className="flex flex-col gap-2">
          {block.items.map((item) => (
            <details
              key={item.q}
              className="group rounded-lg border border-[#EEF0F3] bg-white open:bg-[#FAFBFC]"
            >
              <summary
                className={cn(
                  "cursor-pointer list-none px-4 py-3 text-sm leading-[22px] font-semibold text-[#111827] [&::-webkit-details-marker]:hidden",
                  focusRing,
                )}
              >
                <span aria-hidden className="mr-2 inline-block text-[#6B7280] group-open:rotate-90">
                  ›
                </span>
                {item.q}
              </summary>
              <div className="flex flex-col gap-2 px-4 pb-3.5 pl-[34px]">
                {item.a.map((line, i) => (
                  <p key={i} className={P}>
                    <Rich text={line} />
                  </p>
                ))}
              </div>
            </details>
          ))}
        </div>
      );
  }
}

/** Every guide in order, with a sticky contents list beside it. */
export function HelpGuides({ guides }: { guides: readonly Guide[] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_220px] items-start gap-6 max-[1201px]:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-8">
        {guides.map((guide) => (
          <section
            key={guide.slug}
            aria-labelledby={`g-${guide.slug}`}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-0.5">
              <h2
                id={`g-${guide.slug}`}
                className="m-0 text-lg leading-7 font-semibold tracking-[-0.01em] text-[#111827]"
              >
                {guide.title}
              </h2>
              <p className="m-0 text-[13px] leading-[19px] text-[#6B7280]">{guide.summary}</p>
            </div>
            {guide.sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className={cn(card, "flex scroll-mt-6 flex-col gap-3 px-5 py-4 max-[641px]:px-4")}
              >
                <h3
                  id={`${section.id}-title`}
                  className="m-0 text-[15px] leading-[22px] font-semibold text-[#111827]"
                >
                  {section.title}
                </h3>
                {section.blocks.map((block, i) => (
                  <BlockView key={i} block={block} />
                ))}
              </section>
            ))}
          </section>
        ))}
      </div>
      <nav aria-label="Contents" className="sticky top-6 flex flex-col gap-3 max-[1201px]:hidden">
        {guides.map((guide) => (
          <div key={guide.slug} className="flex flex-col gap-0.5">
            <h3 className="m-0 mb-0.5 px-2 text-sm leading-5 font-semibold text-[#111827]">
              {guide.title}
            </h3>
            {guide.sections.map((section) => (
              <Link
                key={section.id}
                href={`#${section.id}`}
                className={cn(
                  "rounded-md px-2 py-1 text-[13px] leading-[18px] text-[#4B5563] no-underline hover:bg-[#F3F4F6] hover:text-[#111827]",
                  focusRing,
                )}
              >
                {section.title}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

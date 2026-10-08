"use client";

import { FieldError, Section, TextArea, TextInput } from "@/components/rl";

import type { StepProps, UrlCheckEntry } from "./types";
import { StepHeading, UrlCheckLine } from "./ui";

/** Step 2 — Setup (design L841–864): name, control/page URL with a real check on blur, hypothesis. */
export function StepSetup({
  draft,
  update,
  err,
  urlCheck,
  onCheckUrl,
}: StepProps & {
  urlCheck: (url: string) => UrlCheckEntry | undefined;
  onCheckUrl: (url: string) => void;
}) {
  const R = draft.type === "redirect";
  const errName = err("basics", "name");
  const errUrl = err("basics", "url");
  return (
    <>
      <StepHeading title="Name it and pick the page">
        {R
          ? "The existing page. Visitors who land here are split between this page and your variant URLs."
          : "The page you want to change. Variants are built on top of it in the visual editor; the live page is never modified."}
      </StepHeading>
      <Section as="div" padded className="gap-[18px]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-extrabold">Experiment name</span>
          <TextInput
            name="name"
            value={draft.name}
            invalid={!!errName}
            placeholder="e.g. Landing page — shorter form"
            onChange={(e) => {
              const v = e.target.value;
              update((d) => ({ ...d, name: v }));
            }}
          />
          <FieldError>{errName}</FieldError>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-extrabold">{R ? "Control URL" : "Page URL"}</span>
          <TextInput
            name="url"
            mono
            inputMode="url"
            className="text-[13.5px]"
            value={draft.url}
            invalid={!!errUrl}
            placeholder={R ? "https://example.com/landing-page" : "https://example.com/product"}
            onChange={(e) => {
              const v = e.target.value;
              update((d) => ({ ...d, url: v }));
            }}
            onBlur={() => onCheckUrl(draft.url)}
          />
          <FieldError>{errUrl}</FieldError>
          {!errUrl ? <UrlCheckLine entry={urlCheck(draft.url)} url={draft.url} /> : null}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-extrabold">
            Hypothesis <span className="font-medium text-ink-3">· optional</span>
          </span>
          <TextArea
            name="hypothesis"
            rows={3}
            value={draft.hypothesis}
            placeholder="If we … then … because …"
            onChange={(e) => {
              const v = e.target.value;
              update((d) => ({ ...d, hypothesis: v }));
            }}
          />
          <span className="text-[12.5px] text-ink-3">
            Shown on the results page so everyone remembers why this test exists.
          </span>
        </label>
      </Section>
    </>
  );
}

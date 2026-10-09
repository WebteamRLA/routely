"use client";

import { FieldError, Section, TextInput } from "@/components/rl";

import type { StepProps, UrlCheckEntry } from "./types";
import { StepHeading, UrlCheckLine } from "./ui";
import { AbVariantRows, SplitVariantRows } from "./step-variants";

export interface SetupProps extends StepProps {
  urlCheck: (url: string) => UrlCheckEntry | undefined;
  onCheckUrl: (url: string) => void;
  onRemoveArm: (i: number) => void;
  /** Opens the visual editor on an arm (0 = control, in preview). */
  onOpenEditor: (arm: number) => void;
  /** Whether the project's tracking snippet is verified — the visual editor needs it. */
  installed: boolean;
}

/**
 * Step 2 — Setup (design v2, L434–500): name and the control/page URL with a real check on blur,
 * then the variants in the same card — Split URL per-arm URL rows, or A/B rows with each
 * variant's changes and the visual editor. Design v2 merged the old Variants step in here and
 * dropped the hypothesis field.
 */
export function StepSetup(props: SetupProps) {
  const { draft, update, err, urlCheck, onCheckUrl } = props;
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
        {R ? <SplitVariantRows {...props} /> : <AbVariantRows {...props} />}
      </Section>
    </>
  );
}

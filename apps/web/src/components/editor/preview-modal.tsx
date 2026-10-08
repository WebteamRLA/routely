"use client";

import { useState } from "react";

import { ArmSwatch, BrowserBar, Diamond, Modal, STRIPES, Segmented } from "@/components/rl";
import { armColor, type ArmDraft, type ExperimentKind } from "@/lib/domain";
import { pathOf } from "@/lib/domain-normalize";
import { changeCount, pageVals } from "@/lib/editor";

import { MockHero, MockSiteHeader, siteBrand } from "./mock-page";
import { previewLink } from "./preview-link";

export interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  type: ExperimentKind;
  /** Control URL (Split URL) or the page URL (A/B). */
  url: string;
  /** Control first. Split URL arms carry their URL; A/B variants their changes. */
  arms: ArmDraft[];
  initialArm?: number;
  projectName: string;
  /**
   * A saved experiment's id. When given, each arm also gets a real "Open on your site ↗" link
   * (`?routely_preview=<id>:<position>`), which the SDK serves without recording anything.
   */
  experimentId?: string;
}

/**
 * The design's preview overlay (DESIGN.md 3.5, L1924–1959): arm tabs, browser chrome, the QA
 * strip, then the A/B mock page with the arm's changes applied or the Split URL redirect notice
 * and a placeholder for the arm's page. Only "Close" (or Escape) dismisses it.
 */
export function PreviewModal({
  open,
  onClose,
  type,
  url,
  arms,
  initialArm = 0,
  projectName,
  experimentId,
}: PreviewModalProps) {
  const [arm, setArm] = useState(initialArm);
  const [prevOpen, setPrevOpen] = useState(open);

  // Each time the modal opens, start on the arm it was opened for.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setArm(initialArm);
  }

  if (arms.length === 0) return null;

  const i = Math.min(arm, arms.length - 1);
  const a = arms[i]!;
  const isRedirect = type === "redirect";
  const target =
    (isRedirect ? (i ? a.url : url) : url).trim().replace(/\*/g, "") || "https://example.com";
  const pagePath = pathOf(target) || "/";
  const brand = siteBrand(projectName);
  const live = experimentId ? previewLink(url, experimentId, i) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Preview"
      width={1100}
      padded={false}
      dismissOnBackdrop={false}
      z={95}
      className="overflow-hidden rounded-lg"
      overlayClassName="bg-[rgba(10,22,51,0.6)] p-[clamp(8px,3vw,32px)]"
    >
      <div className="flex flex-wrap items-center gap-2.5 bg-navy px-3.5 py-2.5 text-white">
        <span className="font-heading font-semibold">Preview</span>
        <Segmented
          variant="dark"
          role="tab"
          ariaLabel="Version"
          className="w-auto flex-wrap"
          itemClassName="flex items-center gap-1.5"
          options={arms.map((x, j) => ({
            value: String(j),
            label: (
              <>
                <ArmSwatch position={j} size={8} />
                {x.name}
              </>
            ),
          }))}
          value={String(i)}
          onChange={(v) => setArm(Number(v))}
        />
        <div className="flex-1" />
        {live ? (
          <a
            href={live}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12.5px] font-bold text-[#C9D6FF] hover:text-white"
          >
            Open on your site ↗
          </a>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="h-8 cursor-pointer rounded-md border border-white/25 bg-transparent px-3 font-bold text-white hover:bg-white/10"
        >
          Close
        </button>
      </div>
      <BrowserBar url={target} />
      <div className="flex flex-wrap gap-2 bg-[#FFF4EF] px-3.5 py-[7px] text-[12.5px] font-bold text-[#8A3A1F]">
        <Diamond size={8} className="mt-1" />
        QA preview · {a.name} · this visit is not counted in results
      </div>
      <div className="overflow-auto">
        {isRedirect ? (
          <>
            {i > 0 ? (
              <div className="bg-brand-tint-2 px-4 py-2.5 text-[12.5px] font-bold text-[#1F3FB0]">
                ↪ Redirected from {pathOf(url) || url} · client-side, before paint · query
                parameters kept
              </div>
            ) : null}
            <div className="flex flex-col gap-3.5 p-7">
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-extrabold">{brand}</span>
                <span className="truncate font-mono text-xs text-ink-3">{pagePath}</span>
              </div>
              <div
                className="flex h-[360px] items-center justify-center rounded-lg border-2"
                style={{
                  borderColor: armColor(i),
                  background: STRIPES,
                }}
              >
                <span className="max-w-[90%] rounded-sm bg-white px-2.5 py-1.5 text-center font-mono text-[12.5px] break-all text-ink-2">
                  {a.name} page · {pagePath}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <MockSiteHeader
              brand={brand}
              right={
                <span className="text-xs text-ink-3">{changeCount(a.changes.length)} applied</span>
              }
            />
            <MockHero vals={pageVals(a.changes)} pageUrl={target} layout="preview" />
          </>
        )}
      </div>
    </Modal>
  );
}

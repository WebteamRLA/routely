"use client";

import { Modal } from "@/components/rl";
import { InstallPanel } from "@/components/tracking/install-panel";
import type { InstallInfo } from "@/components/tracking/types";

export interface InstallModalProps {
  open: boolean;
  onClose: () => void;
  install: InstallInfo;
  projectName: string;
  /** "wizard": the success action reads "Continue to launch"; "settings": "Done". */
  context: "wizard" | "settings";
  /** Called by "Continue to launch" / "Done". Defaults to `onClose`. */
  onContinue?: () => void;
}

/**
 * The install modal (DESIGN.md 3.7): the Installation panel in a 760px dialog with a × beside the
 * status badge, a continue button in the success banner and a sticky footer. Escape and a backdrop
 * click close it.
 */
export function InstallModal({
  open,
  onClose,
  install,
  projectName,
  context,
  onContinue,
}: InstallModalProps) {
  const continueText = context === "wizard" ? "Continue to launch" : "Done";
  const proceed = onContinue ?? onClose;

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Install Routely"
      width={760}
      padded={false}
      z={115}
      className="max-h-[calc(100vh-32px)] gap-0"
    >
      <InstallPanel
        install={install}
        projectName={projectName}
        headerAside={
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="size-8 cursor-pointer rounded-md border border-input bg-card text-lg text-ink-2 outline-none hover:bg-[#F5F6F9] focus-visible:ring-3 focus-visible:ring-primary/30"
          >
            ×
          </button>
        }
        successAction={
          <button
            type="button"
            onClick={proceed}
            className="h-[38px] cursor-pointer rounded-md border-0 bg-success px-4 text-[13.5px] font-extrabold text-white outline-none hover:bg-[#0F8A5C] focus-visible:ring-3 focus-visible:ring-primary/30"
          >
            {continueText}
          </button>
        }
        footer={(installed) => (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2.5 border-t border-divider bg-card px-4 py-3.5 sm:px-[22px]">
            <span className="text-[12.5px] text-ink-3">
              Project-level · shared by every A/B and split URL test in {projectName}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-[38px] cursor-pointer rounded-md border border-input bg-card px-3.5 font-bold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-primary/30"
              >
                {installed ? "Close" : "Cancel"}
              </button>
              {installed ? (
                <button
                  type="button"
                  onClick={proceed}
                  className="h-[38px] cursor-pointer rounded-md border-0 bg-brand px-4 font-extrabold text-white outline-none hover:bg-brand-hover focus-visible:ring-3 focus-visible:ring-primary/30"
                >
                  {continueText}
                </button>
              ) : null}
            </div>
          </div>
        )}
      />
    </Modal>
  );
}

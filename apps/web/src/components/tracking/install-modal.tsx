"use client";

import { Modal } from "@/components/rl";
import { InstallPanel } from "@/components/tracking/install-panel";
import type { InstallInfo } from "@/components/tracking/types";

export interface InstallModalProps {
  open: boolean;
  onClose: () => void;
  install: InstallInfo;
  projectName: string;
  /** "wizard": the footer's success action reads "Continue to launch"; "settings": "Done". */
  context: "wizard" | "settings";
  /** Called by "Continue to launch" / "Done". Defaults to `onClose`. */
  onContinue?: () => void;
  /**
   * Opened from the visual editor's install gate: the host the editor wants to load. Shows the
   * amber "Install Routely to open the visual editor" note above the snippet.
   */
  editorHost?: string;
  /**
   * Called once, when a verification the customer runs in this modal detects the snippet — so the
   * caller can close the modal and open the editor. With `editorHost` set, the toast reads
   * "Routely verified · opening the visual editor".
   */
  onVerified?: () => void;
}

/**
 * The install modal (design v2): the Installation panel in a 760px dialog with a × beside the
 * status badge and a sticky footer whose continue button appears once tracking is installed.
 * Escape and a backdrop click close it. The panel unmounts on close, so every opening starts fresh.
 */
export function InstallModal({
  open,
  onClose,
  install,
  projectName,
  context,
  onContinue,
  editorHost,
  onVerified,
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
        editorHost={editorHost}
        onVerified={onVerified}
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
        footer={(installed) => (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2.5 border-t border-divider bg-card px-[22px] py-3.5">
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

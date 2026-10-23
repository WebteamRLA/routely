"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CopyIcon, Spinner } from "@/components/rt/icons";
import { Modal, ModalBody, ModalFooter } from "@/components/rt/modal";
import { btn, help, input, mono } from "@/components/rt/styles";
import { IDLE } from "@/lib/form-state";
import { cn } from "@/lib/utils";
import {
  disableSharingAction,
  enableSharingAction,
  rotateShareTokenAction,
} from "@/server/actions/share.actions";

type Op = "enable" | "rotate" | "disable";

const ACTIONS = {
  enable: enableSharingAction,
  rotate: rotateShareTokenAction,
  disable: disableSharingAction,
};

const DONE: Record<Op, [string, string]> = {
  enable: ["Share link created", "Anyone with the link can see these results."],
  rotate: ["New link created", "The previous link no longer works."],
  disable: ["Sharing turned off", "The link no longer works."],
};

/**
 * The public results link: create it, copy it, replace it ("this link got out"), or turn it off.
 * Not in the design — reached from the header's "More actions" menu, for Editors and up only.
 * The Server Actions re-check the role; this dialog is never the check.
 */
export function ShareDialog({
  open,
  onOpenChange,
  experimentId,
  shareUrl,
  notify,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  experimentId: string;
  shareUrl: string | null;
  notify(title: string, note: string): void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Op | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (op: Op) => {
    if (busy) return;
    setBusy(op);
    const form = new FormData();
    form.set("experimentId", experimentId);
    const state = await ACTIONS[op](IDLE, form);
    setBusy(null);
    if (state.status === "error") {
      notify("Couldn’t update the share link", state.message ?? "Something went wrong.");
      return;
    }
    notify(...DONE[op]);
    router.refresh();
  };

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      notify("Couldn’t copy the link", "Select the link and copy it instead.");
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Share results"
      description="Anyone with the link can see this experiment’s results without signing in. They can’t see anything else in your workspace."
      busy={busy !== null}
      width={520}
    >
      <ModalBody>
        {shareUrl ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 max-[641px]:flex-col">
              <input
                readOnly
                value={shareUrl}
                aria-label="Share link"
                onFocus={(e) => e.currentTarget.select()}
                className={cn(input, mono, "min-w-0 flex-auto text-[13px]")}
              />
              <button
                type="button"
                onClick={() => void copy()}
                className={cn(btn.secondary, "h-10")}
              >
                <CopyIcon />
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className={help}>
              The link works until you turn it off or create a new one. Search engines don’t index
              it.
            </p>
          </div>
        ) : (
          <p className={help}>
            There’s no link yet. Create one to share these results with someone outside your
            workspace.
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        {shareUrl ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("disable")}
              className={btn.dangerOutline}
            >
              {busy === "disable" ? <Spinner /> : null}
              Turn off link
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("rotate")}
              className={btn.secondary}
            >
              {busy === "rotate" ? <Spinner /> : null}
              Create new link
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onOpenChange(false)}
              className={btn.primary}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onOpenChange(false)}
              className={btn.secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("enable")}
              className={btn.primary}
            >
              {busy === "enable" ? <Spinner /> : null}
              Create link
            </button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}

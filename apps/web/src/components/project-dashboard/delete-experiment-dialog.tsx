"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AlertCircleIcon, Spinner } from "@/components/rt/icons";
import { Modal, ModalBody, ModalFooter } from "@/components/rt/modal";
import { btn, errorText } from "@/components/rt/styles";
import type { PdExperiment } from "@/lib/project-dashboard";
import { cn } from "@/lib/utils";
import { removeExperimentAction } from "@/server/actions/experiment.actions";

/**
 * Confirms deleting one experiment from the project dashboard. Not in the design, which has no
 * delete control here; built on the design's alert dialog. Deleting removes the experiment with its
 * visitors, conversions and results (they cascade), so the copy says so plainly. The Server Action
 * re-checks the role — Admins delete anything, an Editor only a draft — and this dialog is never
 * the check.
 */
export function DeleteExperimentDialog({
  experiment,
  onClose,
  notify,
}: {
  experiment: PdExperiment | null;
  onClose(): void;
  notify(title: string, note: string): void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!experiment || busy) return;
    setBusy(true);
    setError(null);
    const result = await removeExperimentAction(experiment.id).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setError(
        result && result.code !== "INTERNAL"
          ? result.message
          : "We couldn’t delete the experiment. Try again.",
      );
      return;
    }
    onClose();
    notify(
      `${experiment.name} deleted`,
      experiment.status === "draft"
        ? "The draft was removed."
        : "Its visitors, conversions and results were removed.",
    );
    router.refresh();
  };

  const draft = experiment?.status === "draft";
  const visitors = experiment?.visitors ?? 0;
  const description = draft
    ? "This draft and its setup will be deleted. This can’t be undone."
    : `Its results will be deleted for good${
        visitors > 0
          ? ` — ${visitors.toLocaleString("en-US")} ${visitors === 1 ? "visitor" : "visitors"} and every conversion`
          : ""
      }. This can’t be undone.`;

  return (
    <Modal
      open={experiment !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={experiment ? `Delete “${experiment.name}”?` : "Delete experiment?"}
      description={description}
      busy={busy}
      alert
      width={460}
    >
      {experiment?.status === "running" || error ? (
        <ModalBody className="flex flex-col gap-2">
          {experiment?.status === "running" ? (
            <p className="m-0 text-[13px] leading-[19px] text-[#4B5563]">
              It’s running now. Visitors stop being sent to its versions within a few minutes. To
              keep the results, pause or end it instead.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className={cn(errorText, "m-0 flex items-start gap-1.5")}>
              <AlertCircleIcon size={14} className="mt-0.5 flex-none" />
              <span>{error}</span>
            </p>
          ) : null}
        </ModalBody>
      ) : null}
      <ModalFooter>
        <button type="button" className={btn.secondary} onClick={close} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={btn.danger}
          onClick={() => void confirm()}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? (
            <>
              <Spinner size={14} />
              Deleting…
            </>
          ) : (
            "Delete experiment"
          )}
        </button>
      </ModalFooter>
    </Modal>
  );
}

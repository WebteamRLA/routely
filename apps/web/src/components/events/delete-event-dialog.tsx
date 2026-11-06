"use client";

import { useState } from "react";

import { AlertCircleIcon, Spinner } from "@/components/rt/icons";
import { Modal, ModalBody, ModalFooter } from "@/components/rt/modal";
import { btn, errorText } from "@/components/rt/styles";
import { cn } from "@/lib/utils";
import { deleteEventAction } from "@/server/actions/event.actions";
import type { LibraryEvent } from "@/server/services/custom-event.service";

/**
 * Confirms deleting an event. The service decides: a launched experiment's goal can't be deleted,
 * and that refusal is shown here, not worked out in the browser. A draft's goal can, and the draft
 * then has none.
 */
export function DeleteEventDialog({
  event,
  websiteId,
  onClose,
  onDeleted,
}: {
  event: LibraryEvent & { id: string };
  websiteId: string;
  onClose(): void;
  onDeleted(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteEventAction(event.id, websiteId).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      setError(
        result && result.code !== "INTERNAL"
          ? result.message
          : "We couldn’t delete the event. Try again.",
      );
      return;
    }
    onDeleted();
  };

  const drafts = event.usage.filter((use) => use.status === "DRAFT").length;
  const received = event.total > 0;

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Delete “${event.name}”?`}
      description={
        received
          ? "Routely stops listening for it. What it already received stays, and the name shows as not set up."
          : "Routely stops listening for it. This can’t be undone."
      }
      busy={busy}
      alert
      width={460}
    >
      {drafts > 0 || error ? (
        <ModalBody className="gap-2">
          {drafts > 0 ? (
            <p className="m-0 text-[13px] leading-[19px] text-[#4B5563]">
              {drafts === 1
                ? "A draft experiment uses it as its goal. That draft will need a new goal."
                : `${drafts} draft experiments use it as their goal. They’ll need a new goal.`}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className={cn(errorText, "flex items-start gap-1.5")}>
              <AlertCircleIcon size={14} className="mt-0.5 flex-none" />
              <span>{error}</span>
            </p>
          ) : null}
        </ModalBody>
      ) : null}
      <ModalFooter>
        <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={btn.danger}
          onClick={() => void confirm()}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? <Spinner size={14} /> : null}
          {busy ? "Deleting…" : "Delete event"}
        </button>
      </ModalFooter>
    </Modal>
  );
}

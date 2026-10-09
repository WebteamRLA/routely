"use client";

import { ConfirmModal } from "@/components/rl";

/** "Delete this experiment?" (prototype L2043–2047). */
export function DeleteExperimentModal({
  name,
  open,
  pending,
  onClose,
  onConfirm,
}: {
  name: string;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      title="Delete this experiment?"
      body={`“${name}” and all of its results will be permanently removed. This can’t be undone.`}
      confirmLabel={pending ? "Deleting…" : "Delete"}
      onConfirm={onConfirm}
      tone="danger"
      titleWeight={600}
      pending={pending}
    />
  );
}

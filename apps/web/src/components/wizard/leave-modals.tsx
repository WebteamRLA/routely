"use client";

import { Modal, ModalActions, ModalTitle } from "@/components/rl";
import { Button } from "@/components/ui/button";

export type LeaveModal =
  | { kind: "exit" }
  | { kind: "switch"; proceed: () => void; to?: string }
  | { kind: "logout"; proceed: () => void };

const COPY = {
  exit: {
    title: "Leave without saving?",
    body: "You have unsaved changes. Save as a draft to pick up where you left off.",
    discard: "Discard",
    save: "Save draft",
  },
  switch: {
    title: "Switch project with unsaved changes?",
    body: "",
    discard: "Discard & switch",
    save: "Save draft & switch",
  },
  logout: {
    title: "Log out with unsaved changes?",
    body: "Your experiment setup hasn’t been saved. Save it as a draft first, or log out and discard it.",
    discard: "Discard & log out",
    save: "Save draft & log out",
  },
} as const;

/** The prototype's exit / switch / logout guards (L1994–1998, L2033–2042). */
export function LeaveModals({
  modal,
  projectName,
  saving,
  onCancel,
  onDiscard,
  onSave,
}: {
  modal: LeaveModal | null;
  projectName: string;
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const kind = modal?.kind ?? "exit";
  const c = COPY[kind];
  const body =
    modal?.kind === "switch"
      ? `Your experiment setup in ${projectName} hasn’t been saved. Save it as a draft before switching to ${modal.to ?? "the other project"}?`
      : c.body;
  return (
    <Modal open={!!modal} onClose={onCancel} label={c.title} locked={saving}>
      <ModalTitle title={c.title}>{body}</ModalTitle>
      <ModalActions>
        {kind === "exit" ? (
          <>
            <Button variant="destructive-outline" size="lg" onClick={onDiscard} disabled={saving}>
              {c.discard}
            </Button>
            <Button variant="outline" size="lg" onClick={onCancel} disabled={saving}>
              Keep editing
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="lg" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button variant="destructive-outline" size="lg" onClick={onDiscard} disabled={saving}>
              {c.discard}
            </Button>
          </>
        )}
        <Button size="lg" onClick={onSave} disabled={saving} className="font-extrabold">
          {saving ? "Saving…" : c.save}
        </Button>
      </ModalActions>
    </Modal>
  );
}

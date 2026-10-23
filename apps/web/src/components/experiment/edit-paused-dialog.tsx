"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AlertCircleIcon, Spinner } from "@/components/rt/icons";
import { Modal, ModalBody, ModalFooter } from "@/components/rt/modal";
import { btn, errorText, help, input, label } from "@/components/rt/styles";
import { NAME_MAX } from "@/lib/launch-rules";
import { cn } from "@/lib/utils";
import { updatePausedExperimentAction } from "@/server/actions/experiment.actions";

// The wizards' wording (lib/launch-rules.ts), so a field reads the same wherever it is edited.
const NAME_REQUIRED = "Give your experiment a name.";
const NAME_TOO_LONG = `Use ${NAME_MAX} characters or fewer.`;
const PERCENT_RANGE = "Enter a percentage between 1 and 100.";

function nameError(value: string): string | null {
  const name = value.trim();
  if (!name) return NAME_REQUIRED;
  if (name.length > NAME_MAX) return NAME_TOO_LONG;
  return null;
}

function percentError(value: string): string | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return PERCENT_RANGE;
  const n = Number(text);
  return n >= 1 && n <= 100 ? null : PERCENT_RANGE;
}

/**
 * Editing a paused experiment (D7): its name and the share of site traffic included, nothing
 * else. Not in the design — opened from the Review tab's Configuration card, for Editors and up
 * on a paused experiment only. The Server Action re-checks the role and the status; this dialog
 * is never the check.
 */
export function EditPausedDialog({
  open,
  onOpenChange,
  experimentId,
  name,
  include,
  notify,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  experimentId: string;
  name: string;
  /** `trafficAllocation`, 1–100. */
  include: number;
  notify(title: string, note: string): void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit experiment"
      description="While it’s paused you can rename the experiment and change how much of your site’s traffic it includes. Pages, versions, targeting and the goal stay as launched."
      busy={busy}
      width={520}
    >
      {/* Mounted only while open (see Modal), so every opening starts from the stored values. */}
      <EditPausedForm
        experimentId={experimentId}
        name={name}
        include={include}
        notify={notify}
        busy={busy}
        setBusy={setBusy}
        close={() => onOpenChange(false)}
      />
    </Modal>
  );
}

function EditPausedForm({
  experimentId,
  name: storedName,
  include: storedInclude,
  notify,
  busy,
  setBusy,
  close,
}: {
  experimentId: string;
  name: string;
  include: number;
  notify(title: string, note: string): void;
  busy: boolean;
  setBusy(busy: boolean): void;
  close(): void;
}) {
  const router = useRouter();
  const [name, setName] = useState(storedName);
  const [include, setInclude] = useState(String(storedInclude));
  const [shown, setShown] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string[]>>({});

  const nameErr = nameError(name) ?? serverFields["name"]?.[0] ?? null;
  const includeErr = percentError(include) ?? serverFields["trafficAllocation"]?.[0] ?? null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setShown(true);
    setServerError(null);
    setServerFields({});
    if (nameError(name) || percentError(include)) return;

    const changes: { name?: string; trafficAllocation?: number } = {};
    const nextName = name.trim();
    const nextInclude = Number(include.trim());
    if (nextName !== storedName) changes.name = nextName;
    if (nextInclude !== storedInclude) changes.trafficAllocation = nextInclude;
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }

    setBusy(true);
    const result = await updatePausedExperimentAction(experimentId, changes);
    setBusy(false);
    if (!result.ok) {
      setServerFields(result.fieldErrors ?? {});
      setServerError(result.message);
      return;
    }
    close();
    notify(
      "Experiment updated",
      changes.trafficAllocation !== undefined
        ? `${result.data.trafficAllocation}% of site traffic will be included when you resume.`
        : "The new name is saved.",
    );
    router.refresh();
  };

  const showName = shown && nameErr !== null;
  const showInclude = shown && includeErr !== null;

  return (
    <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col">
      <ModalBody>
        {serverError ? (
          <p role="alert" className={cn(errorText, "flex items-start gap-1.5")}>
            <AlertCircleIcon size={14} className="mt-0.5 flex-none" />
            <span>{serverError}</span>
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rt-edit-name" className={label}>
            Experiment name
          </label>
          <input
            id="rt-edit-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            aria-invalid={showName}
            aria-describedby={showName ? "rt-edit-name-err" : undefined}
            disabled={busy}
            className={input}
          />
          {showName ? (
            <p id="rt-edit-name-err" className={errorText}>
              {nameErr}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rt-edit-include" className={label}>
            Traffic share
          </label>
          <div className="flex items-center gap-2">
            <input
              id="rt-edit-include"
              type="text"
              inputMode="numeric"
              value={include}
              onChange={(e) => setInclude(e.target.value)}
              aria-invalid={showInclude}
              aria-describedby={showInclude ? "rt-edit-include-err" : "rt-edit-include-help"}
              disabled={busy}
              className={cn(input, "w-24 tabular-nums")}
            />
            <span className="text-sm text-[#4B5563]">% of site traffic</span>
          </div>
          {showInclude ? (
            <p id="rt-edit-include-err" className={errorText}>
              {includeErr}
            </p>
          ) : (
            <p id="rt-edit-include-help" className={help}>
              From 1 to 100. Applies to new visitors — anyone Routely has already counted in or out
              keeps that decision.
            </p>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={close} disabled={busy} className={btn.secondary}>
          Cancel
        </button>
        <button type="submit" disabled={busy} className={btn.primary}>
          {busy ? <Spinner /> : null}
          {busy ? "Saving…" : "Save changes"}
        </button>
      </ModalFooter>
    </form>
  );
}

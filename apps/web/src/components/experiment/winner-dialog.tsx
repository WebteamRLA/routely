"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AlertCircleIcon, CheckIcon, Spinner, WarningIcon } from "@/components/rt/icons";
import { Modal, ModalBody, ModalFooter } from "@/components/rt/modal";
import { btn, errorText, focusRing } from "@/components/rt/styles";
import type { ResultsModel } from "@/lib/experiment-model";
import { NOT_PROOF_NOTE } from "@/lib/verdict";
import { cn } from "@/lib/utils";
import { chooseWinnerAction, endExperimentAction } from "@/server/actions/experiment.actions";

type Choice = ResultsModel["winnerChoice"];

/**
 * "Choose winner" (not in the design). Ends a running or paused experiment with the version the
 * team keeps, or records — or changes — the choice on an ended one. Routely's recommendation, when
 * the data has one, is marked and preselected; any other pick says why the data doesn't back it
 * before it is made, and the server records it as a judgement call, not a result. The Server
 * Action re-checks the role, the status and the basis; this dialog is never the check.
 */
export function WinnerDialog({
  open,
  onOpenChange,
  experimentId,
  name,
  choice,
  facts,
  notify,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  experimentId: string;
  name: string;
  choice: Choice;
  /** Shown when ending: visitors so far, how long it ran, the result. */
  facts: ResultsModel["endFacts"];
  notify(title: string, note: string): void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        choice.ending
          ? `End “${name}” and choose a winner`
          : choice.currentKey
            ? "Change the winner"
            : "Choose the winner"
      }
      description={
        choice.ending
          ? "Visitors will see the original page from now on and results are frozen. Pick the version you’ll keep."
          : "Record the version you’ll keep. Routely doesn’t change your site — you update it yourself."
      }
      busy={busy}
      width={560}
    >
      {/* Mounted only while open (see Modal), so every opening starts from the stored choice. */}
      <WinnerForm
        experimentId={experimentId}
        name={name}
        choice={choice}
        facts={facts}
        notify={notify}
        busy={busy}
        setBusy={setBusy}
        close={() => onOpenChange(false)}
      />
    </Modal>
  );
}

function WinnerForm({
  experimentId,
  name,
  choice,
  facts,
  notify,
  busy,
  setBusy,
  close,
}: {
  experimentId: string;
  name: string;
  choice: Choice;
  facts: ResultsModel["endFacts"];
  notify(title: string, note: string): void;
  busy: boolean;
  setBusy(busy: boolean): void;
  close(): void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(
    choice.currentKey ?? choice.recommendedKey,
  );
  const [error, setError] = useState<string | null>(null);
  const picked = choice.options.find((o) => o.key === selected) ?? null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !picked) return;
    setBusy(true);
    setError(null);
    const result = await chooseWinnerAction(experimentId, picked.key);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    close();
    notify(
      result.data.basis === "RECOMMENDED"
        ? `${result.data.winner} is the winner`
        : `${result.data.winner} chosen`,
      result.data.basis === "RECOMMENDED"
        ? "Recorded as Routely’s recommendation. Update your site to keep it."
        : "Recorded as your call, not a statistically reliable result. Update your site to keep it.",
    );
    router.refresh();
  };

  const endWithout = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await endExperimentAction(experimentId);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    close();
    notify(`“${name}” has ended`, "No winner chosen. You can choose one later from its results.");
    router.refresh();
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col">
      <ModalBody>
        {error ? (
          <p role="alert" className={cn(errorText, "flex items-start gap-1.5")}>
            <AlertCircleIcon size={14} className="mt-0.5 flex-none" />
            <span>{error}</span>
          </p>
        ) : null}
        {choice.ending ? (
          <div className="flex flex-col gap-2 rounded-xl border border-[#EEF0F3] bg-[#FAFBFC] p-3.5">
            {facts.map((fc) => (
              <div key={fc.label} className="flex justify-between gap-3 text-[13px]">
                <span className="text-[#6B7280]">{fc.label}</span>
                <span className="text-right font-medium text-[#374151] tabular-nums">
                  {fc.value}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-medium text-[#374151]">
            Version to keep
          </legend>
          {choice.options.map((o) => {
            const on = o.key === selected;
            return (
              <label
                key={o.key}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3",
                  on ? "border-[#0070C9] bg-[#F0F7FF]" : "border-[#E5E7EB] hover:bg-[#F9FAFB]",
                  busy && "cursor-default opacity-70",
                )}
              >
                <input
                  type="radio"
                  name="winner"
                  value={o.key}
                  checked={on}
                  onChange={() => setSelected(o.key)}
                  disabled={busy}
                  className={cn("size-4 flex-none accent-[#0070C9]", focusRing)}
                />
                <span
                  aria-hidden
                  className="size-2 flex-[0_0_8px] rounded-full"
                  style={{ background: o.color }}
                />
                <span className="flex min-w-0 flex-auto flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm leading-5 font-semibold text-[#111827]">{o.name}</span>
                    {o.recommended ? (
                      <span className="inline-flex h-5 items-center rounded-md bg-[#DCFCE7] px-1.5 text-xs font-semibold text-[#166534]">
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[13px] leading-[18px] text-[#6B7280] tabular-nums">
                    {o.rate} conversion rate
                    {o.chance ? ` · ${o.chance} chance to beat Control` : ""}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {picked?.caveat ? (
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-3 text-[13px] leading-5 text-[#78350F]"
          >
            <WarningIcon size={16} className="mt-0.5 flex-none text-[#B45309]" />
            <span>
              {picked.caveat} {picked.name} will be recorded as your call, not a statistically
              reliable result.
            </span>
          </div>
        ) : picked ? (
          <div
            role="note"
            className="flex items-start gap-2.5 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-3.5 py-3 text-[13px] leading-5 text-[#14532D]"
          >
            <CheckIcon size={16} className="mt-0.5 flex-none text-[#166534]" />
            <span>
              Routely recommends {picked.name}: every version has enough data and it’s likely the
              best. {NOT_PROOF_NOTE}
            </span>
          </div>
        ) : (
          <p className="m-0 text-[13px] leading-5 text-[#6B7280]">
            The data doesn’t single out a version yet, so nothing is preselected.
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        {choice.ending ? (
          <button
            type="button"
            onClick={() => void endWithout()}
            disabled={busy}
            className={cn(btn.link, "mr-auto")}
          >
            End without choosing
          </button>
        ) : null}
        <button type="button" onClick={close} disabled={busy} className={btn.secondary}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !picked} className={btn.primary}>
          {busy ? <Spinner /> : null}
          {busy
            ? "Saving…"
            : picked
              ? `${choice.ending ? "End and keep" : "Keep"} ${picked.name}`
              : "Choose a version"}
        </button>
      </ModalFooter>
    </form>
  );
}

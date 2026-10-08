"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  ArmSwatch,
  Modal,
  ModalActions,
  ModalTitle,
  RadioCard,
  RadioDot,
  Toggle,
} from "@/components/rl";
import { Button } from "@/components/ui/button";
import { armName, type ExperimentKind } from "@/lib/domain";
import { fP, fS } from "@/lib/format";
import type { ArmStat } from "@/lib/stats";
import { endExperimentAction } from "@/server/actions/experiment.actions";

/**
 * "End experiment" (prototype §3.1 `stop`): pick the outcome to record — an arm or no winner —
 * and, for a Split URL test won by a variant, whether to keep redirecting everyone to it.
 */
export function EndExperimentModal({
  open,
  onClose,
  projectId,
  experimentId,
  name,
  type,
  arms,
  initialWinner,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  experimentId: string;
  name: string;
  type: ExperimentKind;
  /** All-time stats on the primary goal, control first. */
  arms: ArmStat[];
  /** Preselected outcome: arm position, or −1 for no winner. */
  initialWinner: number;
}) {
  const router = useRouter();
  const [winner, setWinner] = useState(initialWinner);
  const [keep, setKeep] = useState(false);
  const [pending, startTransition] = useTransition();

  // Each time the modal opens, start from the preselected outcome.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setWinner(initialWinner);
      setKeep(false);
    }
  }

  const options = [
    ...arms.map((a) => ({
      id: a.i,
      name: a.name,
      color: a.color,
      sub:
        fP(a.cr, 2) +
        " conv. rate" +
        (a.i
          ? " · " + fS(a.lift) + " · " + Math.round((a.prob ?? 0.5) * 100) + "% confident"
          : " · baseline"),
    })),
    { id: -1, name: "No winner", color: "#CBD1DC", sub: "End without declaring a winner" },
  ];
  const showKeep = type === "redirect" && winner > 0;

  function confirm() {
    startTransition(async () => {
      const r = await endExperimentAction({
        projectId,
        experimentId,
        winnerPosition: winner === -1 ? null : winner,
        keepWinner: showKeep && keep,
      });
      if (r.status === "error") return void toast.error(r.message);
      toast("Experiment ended");
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open={open} onClose={onClose} label="End experiment" locked={pending}>
      <ModalTitle title="End experiment">
        <span className="text-[13.5px]">
          “{name}” will stop splitting traffic. Results are kept. Choose the outcome to record:
        </span>
      </ModalTitle>
      <div role="radiogroup" aria-label="Outcome" className="flex flex-col gap-2">
        {options.map((o) => {
          const on = winner === o.id;
          return (
            <RadioCard
              key={o.id}
              selected={on}
              ring={false}
              onSelect={() => setWinner(o.id)}
              className="flex items-center gap-2.5 p-3"
            >
              <RadioDot on={on} />
              <ArmSwatch size={8} color={o.color} />
              <div>
                <div className="text-[13.5px] font-extrabold">{o.name}</div>
                <div className="text-[12.5px] text-ink-3">{o.sub}</div>
              </div>
            </RadioCard>
          );
        })}
      </div>
      {showKeep ? (
        <div className="flex items-start gap-3">
          <Toggle checked={keep} onChange={setKeep} label="Keep redirecting to the winner" />
          <span className="text-[13px] text-ink-2">
            Keep sending 100% of traffic to {armName(winner)}’s URL until you update the original
            page
          </span>
        </div>
      ) : null}
      <ModalActions>
        <Button variant="outline" size="lg" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="dark"
          size="lg"
          className="font-extrabold"
          onClick={confirm}
          disabled={pending}
        >
          {pending ? "Ending…" : "End experiment"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

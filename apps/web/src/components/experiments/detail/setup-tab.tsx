"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";

import { ArmSwatch, Banner, CardTitle, Section } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { WIZARD_STEPS } from "@/lib/domain";
import { pathOf } from "@/lib/domain-normalize";
import { changeCount, changeLabel } from "@/lib/editor";
import { targetSummary } from "@/lib/targeting";
import { totalWeight } from "@/lib/traffic";
import { draftFromExperiment, groupsOf, validateDraft } from "@/lib/validate-draft";
import type { ExperimentDetail } from "@/lib/view-models";
import { editLiveExperimentAction } from "@/server/actions/experiment.actions";

import { type LiveEdit, editError, liveEditChanges, liveEditFrom } from "./live-edit";
import { CoverageField, GoalFields, NameFields, SplitField } from "./live-edit-fields";

function Label({ children }: { children: ReactNode }) {
  return <div className="text-xs font-extrabold tracking-[0.06em] text-ink-3">{children}</div>;
}

/**
 * Draft-only "Setup progress" checklist, one card per wizard step: Setup (which holds the
 * variants since design v2), Traffic, Targeting, Goals. The prototype also lists "Review &
 * launch", which has no fields and so always read "Complete"; it is left out.
 */
function SetupProgress({ detail }: { detail: ExperimentDetail }) {
  const errors = validateDraft(draftFromExperiment(detail.draftSource));
  const steps = WIZARD_STEPS.filter(([k]) => k !== "type" && k !== "review");
  return (
    <Section className="flex flex-col gap-2.5 p-[18px]">
      <CardTitle>Setup progress</CardTitle>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
        {steps.map(([key, label]) => {
          const first = groupsOf(key)
            .flatMap((g) => Object.values(errors[g] ?? {}))
            .at(0);
          return (
            <div key={key} className="flex gap-2.5 rounded-lg border border-divider p-2.5">
              <span
                aria-hidden
                className="grid size-[22px] flex-none place-items-center rounded-full text-xs font-black"
                style={
                  first
                    ? { background: "#FDF3E1", color: "#94600A" }
                    : { background: "#E6F5EE", color: "#0F7A52" }
                }
              >
                {first ? "!" : "✓"}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-extrabold">{label}</div>
                <div className="text-xs text-ink-3">{first ?? "Complete"}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * The Setup tab (prototype L1544–1565): a summary of how the test is configured. Running and
 * paused experiments can edit name, hypothesis, split, coverage and counting inline (service
 * `editLive`); URLs, changes, targeting and the goal stay fixed.
 */
export function SetupTab({
  projectId,
  detail,
  children,
}: {
  projectId: string;
  detail: ExperimentDetail;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<LiveEdit | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, startTransition] = useTransition();
  const editable = detail.status === "running" || detail.status === "paused";
  const update = (fn: (e: LiveEdit) => LiveEdit) => {
    setEdit((e) => (e ? fn(e) : e));
    setErrors(undefined); // a server error describes the values that were sent, not these
  };

  const armDetail = (i: number) => {
    const a = detail.arms[i]!;
    if (detail.type === "redirect") return a.url || "—";
    if (!i) return "Original page, unmodified";
    return a.changes.length
      ? a.changes.map((c) => `${changeLabel(c)}: “${c.value}”`).join(" · ")
      : "No changes";
  };
  const armShort = (i: number) => {
    const a = detail.arms[i]!;
    if (detail.type === "redirect") return pathOf(a.url) || a.url || "—";
    return i ? changeCount(a.changes.length) : "Original page";
  };
  const goal = detail.goal;

  const cancel = () => {
    setEdit(null);
    setErrors(undefined);
  };
  const save = () => {
    if (!edit) return;
    const changes = liveEditChanges(detail, edit);
    if (Object.keys(changes).length === 0) {
      toast("No changes to save");
      return cancel();
    }
    const sum = totalWeight(edit.arms);
    if (sum !== 100) {
      setErrors({ "traffic.sum": [`Allocation adds up to ${sum}%. It must equal 100%.`] });
      return;
    }
    startTransition(async () => {
      const r = await editLiveExperimentAction({
        projectId,
        experimentId: detail.id,
        ...changes,
      });
      if (r.status === "error") {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.message);
        return;
      }
      toast("Changes saved");
      // Leave edit mode in the same transition as the refresh, so the summary never flashes
      // the old values: the form stays (pending) until the fresh props arrive.
      startTransition(() => {
        cancel();
        router.refresh();
      });
    });
  };

  const err = (...keys: string[]) => editError(errors, ...keys);
  const fixedNote =
    detail.type === "redirect"
      ? "URLs are fixed once an experiment has started — visitors are already bucketed. Targeting and the goal are fixed too."
      : "Changes are fixed once an experiment has started — visitors are already bucketed. The page URL, targeting and the goal are fixed too.";

  return (
    <div className="flex flex-col gap-[18px]">
      {detail.status === "draft" ? <SetupProgress detail={detail} /> : null}
      {editable ? (
        edit ? (
          <Banner tone="hint">{fixedNote}</Banner>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <span className="text-[13px] text-ink-3">
              Name, traffic split, coverage and counting can change while the test runs.
            </span>
            <Button variant="outline" size="sm" onClick={() => setEdit(liveEditFrom(detail))}>
              Edit setup
            </Button>
          </div>
        )
      ) : null}
      <Section aria-busy={pending || undefined}>
        <div className="border-b border-divider px-5 py-4">
          <Label>HYPOTHESIS</Label>
          {edit ? (
            <NameFields
              edit={edit}
              update={update}
              nameError={err("name")}
              hypothesisError={err("hypothesis")}
            />
          ) : (
            <div className="mt-1 text-sm italic">
              {detail.hypothesis || "No hypothesis recorded"}
            </div>
          )}
        </div>
        <div className="border-b border-divider px-5 py-4">
          <Label>VERSIONS</Label>
          {edit ? (
            <>
              {detail.arms.map((a, i) => (
                <div key={a.position} className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
                  <ArmSwatch position={a.position} />
                  <span className="min-w-[78px] font-extrabold">{a.name}</span>
                  <span className="min-w-[200px] flex-1 text-[13px] break-words text-ink-3">
                    {armDetail(i)}
                  </span>
                </div>
              ))}
              <div className="mt-4">
                <Label>TRAFFIC SPLIT</Label>
              </div>
              <SplitField
                edit={edit}
                update={update}
                detailFor={armShort}
                error={err("traffic.sum", "weights")}
              />
            </>
          ) : (
            detail.arms.map((a, i) => (
              <div key={a.position} className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
                <ArmSwatch position={a.position} />
                <span className="min-w-[78px] font-extrabold">{a.name}</span>
                <span className="min-w-[42px] font-bold tabular-nums">{a.weight}%</span>
                <span className="min-w-[200px] flex-1 text-[13px] break-words text-ink-2">
                  {armDetail(i)}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4 border-b border-divider px-5 py-4">
          <div>
            <Label>TRAFFIC</Label>
            {edit ? (
              <CoverageField edit={edit} update={update} error={err("coverage")} />
            ) : (
              <div className="mt-1 text-[13.5px]">{detail.coverage}% of matching visitors</div>
            )}
          </div>
          <div>
            <Label>GOAL</Label>
            <div className="mt-1 text-[13.5px] font-bold break-words">
              {goal ? `${goal.name} · ${goal.eventKey}` : "Not set"}
            </div>
            {edit ? (
              <GoalFields edit={edit} update={update} error={err("counting")} />
            ) : (
              <div className="text-[12.5px] text-ink-3">
                {detail.counting === "unique" ? "Once per visitor" : "Every conversion"}
              </div>
            )}
          </div>
          <div>
            <Label>DELIVERY</Label>
            <div className="mt-1 text-[13.5px]">
              {detail.type === "redirect"
                ? "Redirect before paint · query parameters preserved · bots & crawlers excluded"
                : "Client-side DOM changes · anti-flicker on"}
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <Label>TARGETING</Label>
          <div className="mt-1 text-[13.5px] leading-normal">{targetSummary(detail.targeting)}</div>
        </div>
        {edit ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-divider px-5 py-3.5">
            {err("_form") ? (
              <span role="alert" className="mr-auto text-[13px] font-semibold text-danger-text">
                {err("_form")}
              </span>
            ) : null}
            <Button variant="outline" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        ) : null}
      </Section>
      {children}
    </div>
  );
}

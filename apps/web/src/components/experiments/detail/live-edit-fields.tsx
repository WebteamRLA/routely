"use client";

import { CountingControl } from "@/components/experiments/goal-controls";
import { SplitEditor } from "@/components/experiments/split-editor";
import { FieldError, FormField, TextArea, TextInput } from "@/components/rl";

import type { LiveEdit } from "./live-edit";

type Update = (fn: (e: LiveEdit) => LiveEdit) => void;

/** Name + hypothesis, edited in the HYPOTHESIS row. */
export function NameFields({
  edit,
  update,
  nameError,
  hypothesisError,
}: {
  edit: LiveEdit;
  update: Update;
  nameError: string | null;
  hypothesisError: string | null;
}) {
  return (
    <div className="mt-2 flex flex-col gap-3">
      <FormField label="Experiment name" htmlFor="live-name" error={nameError}>
        <TextInput
          id="live-name"
          value={edit.name}
          maxLength={120}
          invalid={!!nameError}
          onChange={(e) => {
            const v = e.target.value;
            update((s) => ({ ...s, name: v }));
          }}
        />
      </FormField>
      <FormField label="Hypothesis" optional htmlFor="live-hypothesis" error={hypothesisError}>
        <TextArea
          id="live-hypothesis"
          rows={3}
          maxLength={2000}
          value={edit.hypothesis}
          invalid={!!hypothesisError}
          onChange={(e) => {
            const v = e.target.value;
            update((s) => ({ ...s, hypothesis: v }));
          }}
        />
      </FormField>
    </div>
  );
}

/** The traffic split, with the wizard traffic step's behaviour (setWeight / evenSplit). */
export function SplitField({
  edit,
  update,
  detailFor,
  error,
}: {
  edit: LiveEdit;
  update: Update;
  detailFor: (i: number) => string;
  error: string | null;
}) {
  return (
    <div className="mt-2.5 flex flex-col gap-3.5">
      <SplitEditor
        compact
        arms={edit.arms}
        onArms={(fn) => update((s) => ({ ...s, arms: fn(s.arms) }))}
        detailFor={detailFor}
      />
      {error ? (
        <div role="alert" className="text-[13px] font-bold text-danger-text">
          {error}
        </div>
      ) : null}
      <div className="text-[12.5px] text-ink-3">
        Visitors already in the test keep their version. A new split applies to visitors entering
        from now on.
      </div>
    </div>
  );
}

/** Coverage slider, edited in the TRAFFIC cell. */
export function CoverageField({
  edit,
  update,
  error,
}: {
  edit: LiveEdit;
  update: Update;
  error: string | null;
}) {
  const c = edit.coverage;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <span className="text-[13.5px]">{c}% of matching visitors</span>
      <input
        type="range"
        min={1}
        max={100}
        value={c}
        aria-label="Traffic included in experiment"
        onChange={(e) => {
          const v = Math.max(1, Math.min(100, Number(e.target.value) || 1));
          update((s) => ({ ...s, coverage: v }));
        }}
        className="w-full"
      />
      <span className="text-[12.5px] text-ink-3">
        {c === 100
          ? "All matching visitors enter the experiment."
          : `The other ${100 - c}% see Control and aren’t counted.`}
      </span>
      <FieldError>{error}</FieldError>
    </div>
  );
}

/** Counting, edited in the GOAL cell. The goal itself stays fixed. */
export function GoalFields({
  edit,
  update,
  error,
}: {
  edit: LiveEdit;
  update: Update;
  error: string | null;
}) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <span className="text-[13px] font-extrabold">Count conversions</span>
      <CountingControl
        value={edit.counting}
        onChange={(k) => update((s) => ({ ...s, counting: k }))}
      />
      <FieldError>{error}</FieldError>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CardTitle, FormField, Section, Segmented, SelectInput, TextInput } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { updateProjectAction } from "@/server/actions/project.actions";

/** The prototype's zone list (DESIGN.md 2.7), stored as IANA names. */
const ZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { value: "Europe/London", label: "Europe/London (GMT)" },
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (CET)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT)" },
];

const THRESHOLDS = [90, 95, 99] as const;

/** Settings → Project → "Project" card: name, reporting time zone, significance threshold. */
export function ProjectCard({
  projectId,
  name: initialName,
  timezone: initialTimezone,
  threshold: initialThreshold,
}: {
  projectId: string;
  name: string;
  timezone: string;
  threshold: 90 | 95 | 99;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [threshold, setThreshold] = useState<number>(initialThreshold);
  const [errors, setErrors] = useState<{ name?: string; timezone?: string }>({});
  const [saving, startSave] = useTransition();
  const [, startThreshold] = useTransition();

  const zones = ZONES.some((z) => z.value === initialTimezone)
    ? ZONES
    : [{ value: initialTimezone, label: initialTimezone }, ...ZONES];

  // Like the prototype, the threshold applies the moment it is picked: it changes every verdict.
  function pickThreshold(next: number) {
    if (next === threshold) return;
    const previous = threshold;
    setThreshold(next);
    startThreshold(async () => {
      const result = await updateProjectAction({ projectId, significanceThreshold: next });
      if (result.status === "error") {
        setThreshold(previous);
        toast(result.message);
        return;
      }
      toast(`Significance threshold set to ${next}%`);
      router.refresh();
    });
  }

  function save() {
    if (name.trim().length < 2) {
      setErrors({ name: "Enter a project name." });
      return;
    }
    setErrors({});
    startSave(async () => {
      const result = await updateProjectAction({ projectId, name: name.trim(), timezone });
      if (result.status === "error") {
        setErrors({
          name: result.fieldErrors?.["name"]?.[0],
          timezone: result.fieldErrors?.["timezone"]?.[0],
        });
        if (!result.fieldErrors) toast(result.message);
        return;
      }
      toast("Project settings saved");
      router.refresh();
    });
  }

  return (
    <Section padded className="gap-4">
      <CardTitle size={15.5}>Project</CardTitle>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3.5">
        <FormField label="Project name" htmlFor="project-name" error={errors.name}>
          <TextInput
            id="project-name"
            inputSize="md"
            value={name}
            invalid={!!errors.name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField label="Reporting time zone" htmlFor="project-tz" error={errors.timezone}>
          <SelectInput
            id="project-tz"
            inputSize="md"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {zones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </SelectInput>
        </FormField>
      </div>
      <div className="flex flex-col gap-2">
        <span id="threshold-label" className="text-[13px] font-extrabold">
          Significance threshold
        </span>
        <Segmented
          ariaLabelledby="threshold-label"
          className="flex-nowrap"
          itemClassName="px-3.5 font-extrabold"
          options={THRESHOLDS.map((t) => ({ value: String(t), label: `${t}%` }))}
          value={String(threshold)}
          onChange={(v) => pickThreshold(Number(v))}
        />
        <span className="text-[12.5px] text-ink-3">
          How confident Routely must be before calling a winner. Higher = fewer false positives,
          longer tests. Applies to every experiment’s verdict.
        </span>
      </div>
      <Button className="self-start" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </Section>
  );
}

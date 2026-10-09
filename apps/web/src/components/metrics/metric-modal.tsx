"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField, Modal, RadioCard, TextInput } from "@/components/rl";
import { Button } from "@/components/ui/button";
import type { MetricRow } from "@/lib/view-models";
import { createMetricAction } from "@/server/actions/metric.actions";

export interface MetricModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Opened from the wizard's goal step: the new metric becomes the primary goal (caller does it). */
  fromWizard?: boolean;
  onCreated?: (metric: MetricRow) => void;
}

type Kind = "event" | "page";
type Errors = Partial<Record<"name" | "key" | "url", string>>;

const KEY_RE = /^[a-z][a-z0-9_]*$/;

/** The prototype's client-side checks (DESIGN.md 3.3); the server re-checks everything. */
function localErrors(kind: Kind, name: string, key: string, url: string): Errors {
  const e: Errors = {};
  if (!name.trim()) e.name = "Name is required.";
  if (kind === "event") {
    if (!key.trim()) e.key = "Event name is required.";
    else if (!KEY_RE.test(key.trim()))
      e.key = "Use lowercase letters, numbers and underscores, e.g. demo_booked";
  } else if (!url.trim()) e.url = "Enter the URL that counts as a conversion.";
  return e;
}

/** New metric modal (DESIGN.md 3.3) — creates a real `Metric` via `createMetricAction`. */
export function MetricModal(props: MetricModalProps) {
  // Remounted per opening so every field starts empty.
  if (!props.open) return null;
  return <MetricModalBody {...props} />;
}

function MetricModalBody({ open, onClose, projectId, fromWizard, onCreated }: MetricModalProps) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("event");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [url, setUrl] = useState("");
  const [show, setShow] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();

  const errors: Errors = show ? { ...localErrors(kind, name, key, url), ...serverErrors } : {};

  function save() {
    const local = localErrors(kind, name, key, url);
    setShow(true);
    setServerErrors({});
    if (Object.keys(local).length > 0) return;

    startTransition(async () => {
      const result = await createMetricAction({
        projectId,
        name: name.trim(),
        kind,
        ...(kind === "event" ? { key: key.trim() } : { url: url.trim() }),
      });
      if (result.status === "error") {
        const fe = result.fieldErrors ?? {};
        const next: Errors = {
          name: fe["name"]?.[0],
          key: fe["key"]?.[0],
          url: fe["url"]?.[0],
        };
        if (!next.name && !next.key && !next.url) toast(result.message);
        setServerErrors(next);
        return;
      }
      toast(result.message ?? `Metric “${result.data.name}” created`);
      onCreated?.(result.data);
      router.refresh();
      onClose();
    });
  }

  const types: { value: Kind; label: string; sub: string }[] = [
    { value: "event", label: "Custom event", sub: "Fired from your site or GTM, e.g. purchase" },
    {
      value: "page",
      label: "Page visit",
      sub: "Counts when a visitor reaches a URL, e.g. /thank-you",
    },
  ];

  return (
    <Modal open={open} onClose={onClose} label="New metric" locked={pending}>
      <h2 className="font-heading text-[19px] font-semibold">New metric</h2>
      <form
        className="flex flex-col gap-3.5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div role="radiogroup" aria-label="Metric type" className="grid grid-cols-2 gap-2">
          {types.map((t) => {
            const on = kind === t.value;
            return (
              <RadioCard
                key={t.value}
                selected={on}
                ring={false}
                onSelect={() => {
                  setKind(t.value);
                  setServerErrors({});
                }}
                className="p-3"
              >
                <div className="text-[13.5px] font-extrabold">{t.label}</div>
                <div className="mt-0.5 text-[12px] text-ink-3">{t.sub}</div>
              </RadioCard>
            );
          })}
        </div>

        <FormField label="Name" htmlFor="metric-name" error={errors.name}>
          <TextInput
            id="metric-name"
            inputSize="md"
            autoFocus
            value={name}
            invalid={!!errors.name}
            placeholder="e.g. Demo booked"
            onChange={(e) => {
              setName(e.target.value);
              setServerErrors((s) => ({ ...s, name: undefined }));
            }}
          />
        </FormField>

        {kind === "event" ? (
          <FormField
            label="Event name"
            htmlFor="metric-key"
            error={errors.key}
            help="Must match what your site or GTM sends with routely.track()."
          >
            <TextInput
              id="metric-key"
              inputSize="md"
              mono
              value={key}
              invalid={!!errors.key}
              placeholder="demo_booked"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => {
                setKey(e.target.value);
                setServerErrors((s) => ({ ...s, key: undefined }));
              }}
            />
          </FormField>
        ) : (
          <FormField label="Page URL" htmlFor="metric-url" error={errors.url}>
            <TextInput
              id="metric-url"
              inputSize="md"
              mono
              type="url"
              value={url}
              invalid={!!errors.url}
              placeholder="https://example.com/thank-you"
              spellCheck={false}
              onChange={(e) => {
                setUrl(e.target.value);
                setServerErrors((s) => ({ ...s, url: undefined }));
              }}
            />
          </FormField>
        )}

        {fromWizard ? (
          <div className="text-[12.5px] text-ink-3">
            It will be selected as this experiment’s primary goal.
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Creating…" : "Create metric"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

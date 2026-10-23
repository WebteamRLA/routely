"use client";

import { useActionState, useState } from "react";
import { Eye, Loader2, Wand2 } from "lucide-react";

import { Field } from "@/components/common/field";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormToast } from "@/hooks/use-form-toast";
import { IDLE, type FormState } from "@/lib/form-state";
import type { Metric } from "@/server/services/metrics.service";

/**
 * Conversion goal setup.
 *
 * The goal type is fixed at Pageview because that is the only kind Routely records — click,
 * form and custom-JS goals are not built. It is shown rather than hidden so the page reads the
 * same once there is a second kind, but it is presented as a statement, not as a picker with
 * one option and a "Change" button that changes nothing.
 *
 * The URL fields lock once the experiment has started. That is not a rule invented here:
 * visitors are already bucketed against the old configuration, and moving the goal underneath
 * them would compare conversions on two different definitions of success.
 */
export function GoalSetupForm({
  metric,
  saveAction,
  validateAction,
}: {
  metric: Metric;
  saveAction: (state: FormState, formData: FormData) => Promise<FormState>;
  validateAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [saveState, save] = useActionState(saveAction, IDLE);
  const [validateState, validate, validating] = useActionState(validateAction, IDLE);
  const [url, setUrl] = useState(metric.url);
  const [matchType, setMatchType] = useState<string>(metric.matchType);

  useFormToast(saveState);
  useFormToast(validateState);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">How do you define this conversion goal?</h3>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
          >
            <Eye className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-medium">Pageview</p>
            <p className="text-sm text-muted-foreground">
              Counts a conversion when a visitor reaches a specific URL. The only goal type Routely
              records today.
            </p>
          </div>
        </div>
      </section>

      <form action={save} className="space-y-5">
        <input type="hidden" name="experimentId" value={metric.experimentId} />
        {/* Carried even when the field is locked, so a submission cannot blank the goal. */}
        <input type="hidden" name="conversionMatchType" value={matchType} />
        {!metric.urlEditable ? <input type="hidden" name="conversionUrl" value={url} /> : null}

        <Field
          name="conversionName"
          label="Name this conversion goal"
          hint="Optional. Shown on the metrics list; defaults to the experiment's name."
          errors={saveState.fieldErrors?.["conversionName"]}
        >
          {(props) => (
            <Input
              {...props}
              defaultValue={metric.name === metric.experimentName ? "" : metric.name}
              placeholder={metric.experimentName}
              maxLength={120}
              autoComplete="off"
            />
          )}
        </Field>

        <Field
          name="conversionUrl"
          label="Converted when landed on Page URL"
          hint={
            metric.urlEditable
              ? "Must be on this website's domain, and different from the control and variant pages."
              : "Locked: this experiment has already started, and its visitors are bucketed against this goal. End it and create a new one to measure a different page."
          }
          errors={saveState.fieldErrors?.["conversionUrl"]}
          required={metric.urlEditable}
        >
          {(props) => (
            <Input
              {...props}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={!metric.urlEditable}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required={metric.urlEditable}
            />
          )}
        </Field>

        {metric.urlEditable ? (
          <Field
            name="conversionMatchTypeSelect"
            label="URL match"
            hint="Exact counts only that address. Prefix also counts anything beneath it."
          >
            {() => (
              <Select value={matchType} onValueChange={setMatchType}>
                <SelectTrigger className="w-full sm:w-[16rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXACT">Exact</SelectItem>
                  <SelectItem value="PREFIX">Prefix</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <SubmitButton pendingLabel="Saving…">Save goal</SubmitButton>
        </div>
      </form>

      {/* Its own form: validation loads the page and reports back, and must not be able to
       * save anything as a side effect of checking. */}
      <form
        action={validate}
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4"
      >
        <input type="hidden" name="websiteId" value={metric.websiteId} />
        <input type="hidden" name="conversionUrl" value={url} />
        <p className="min-w-0 text-sm text-muted-foreground">
          Check the goal page loads and carries the tracking snippet — without it, reaching the page
          records nothing.
        </p>
        <Button type="submit" variant="outline" disabled={validating}>
          {validating ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
          {validating ? "Checking…" : "Validate goal"}
        </Button>
      </form>
    </div>
  );
}

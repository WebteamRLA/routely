"use client";

import { type ReactNode, useId, useState } from "react";

import { MAX_EVENT_PROPERTIES } from "@routely/sdk/contract";

import { CodeBlock } from "@/components/common/code-block";
import { ElementPicker, type PickedElement } from "@/components/events/element-picker";
import {
  EVENT_NAME_HINT,
  type EventForm,
  type SuccessChoice,
  type UrlMatch,
  detailsSnippet,
  eventNameError,
  handleSubmitSnippet,
  idempotentSnippet,
  isStepOneError,
  savesAsCode,
  toEventInput,
} from "@/components/events/event-form";
import { AlertCircleIcon, CheckIcon, ChevronDownIcon, Spinner } from "@/components/rt/icons";
import { Modal, ModalBody, ModalFooter, ModalHeader, ModalIcon } from "@/components/rt/modal";
import {
  ACCENT,
  btn,
  errorText,
  help,
  input,
  label as labelClass,
  mono,
} from "@/components/rt/styles";
import {
  EVENT_TEMPLATES,
  type EventMethodName,
  METHOD_LABELS,
  elementTrackScript,
  trackScript,
} from "@/lib/events";
import { isValidPageUrl, sameSiteMessage, withScheme } from "@/lib/launch-rules";
import { isSameSite } from "@/lib/url";
import { cn } from "@/lib/utils";
import { createEventAction, updateEventAction } from "@/server/actions/event.actions";
import type { LibraryEvent } from "@/server/services/custom-event.service";

const METHODS: { value: EventMethodName; note: string }[] = [
  { value: "CLICK", note: "A button or link on your site." },
  { value: "FORM", note: "A form visitors send." },
  { value: "CODE", note: "Your developer reports it from code." },
];

const CATEGORIES = [...new Set(EVENT_TEMPLATES.map((template) => template.category))];

type Errors = Record<string, string>;

/**
 * Create or edit an event, in two steps: what it is, then how Routely knows it happened. Nothing
 * here says an event works once saved: a saved event is only "created", and the library shows it as
 * detected when one actually arrives.
 */
export function EventDialog({
  websiteId,
  domain,
  installHref,
  event,
  initial,
  onClose,
  onSaved,
  onReturn,
}: {
  websiteId: string;
  domain: string;
  installHref: string;
  /** The saved event being edited; null to create one. */
  event: LibraryEvent | null;
  initial: EventForm;
  onClose(): void;
  onSaved(): void;
  /** Set when the visit came from a wizard: a save goes straight back, with this event as its goal,
   * instead of showing the "created" screen (user request 2026-11-09). */
  onReturn?: ((eventId: string) => void) | undefined;
}) {
  const editing = !!event?.id;
  const nameLocked = !!event?.usage.some((use) => use.status !== "DRAFT");

  const [form, setForm] = useState(initial);
  const [step, setStep] = useState<1 | 2 | "done">(1);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [manual, setManual] = useState(!!initial.selector && !initial.picked);

  const patch = (next: Partial<EventForm>) => {
    setForm((current) => ({ ...current, ...next }));
    setErrors((current) => {
      const left = { ...current };
      for (const key of Object.keys(next)) delete left[key];
      return left;
    });
    setFormError(null);
  };

  const next = () => {
    const nameError = eventNameError(form.name);
    if (nameError) {
      setErrors((current) => ({ ...current, name: nameError }));
      return;
    }
    setFormError(null);
    setStep(2);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const input = toEventInput(websiteId, form);
    const result = await (
      event?.id ? updateEventAction(event.id, input) : createEventAction(input)
    ).catch(() => null);

    const savedId = result?.ok ? (result.data?.id ?? event?.id ?? null) : null;
    // From a wizard: straight back to it with this event chosen. Still "Saving…" until it loads.
    if (savedId && onReturn) {
      onReturn(savedId);
      return;
    }
    setSaving(false);

    if (!result) {
      setFormError("We couldn’t reach Routely. Check your connection and try again.");
      return;
    }
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      setFormError(result.message);
      if (isStepOneError(result.fieldErrors)) setStep(1);
      return;
    }
    setErrors({});
    setStep("done");
    onSaved();
  };

  const openPicker = () => {
    if (!isValidPageUrl(form.pageUrl)) {
      setErrors((current) => ({
        ...current,
        pageUrl: "Enter the address of a page on your site.",
      }));
      return;
    }
    if (!isSameSite(withScheme(form.pageUrl), domain)) {
      setErrors((current) => ({ ...current, pageUrl: sameSiteMessage(domain) }));
      return;
    }
    setPicking(true);
  };

  const usePicked = (element: PickedElement) => {
    patch({
      selector: element.selector,
      elementLabel: element.label,
      pageUrl: element.pageUrl,
      picked: true,
    });
    setPicking(false);
  };

  const close = () => {
    if (!saving) onClose();
  };

  if (step === "done") {
    const name = form.name.trim();
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : close())} title={null} width={460}>
        <ModalHeader
          title={editing ? `${name} saved` : `${name} created`}
          description={savedNote(editing, savesAsCode(form))}
          icon={
            <ModalIcon bg="#DCFCE7" fg="#166534">
              <CheckIcon />
            </ModalIcon>
          }
          onClose={close}
        />
        <ModalFooter className="mt-5">
          <button type="button" className={btn.primary} onClick={close}>
            Done
          </button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <>
      {/* Closed while picking, not stacked: its scroll lock would freeze the picker's panel. All
          of the form's state lives above it, so nothing is lost. */}
      <Modal
        open={!picking}
        onOpenChange={(open) => (open ? undefined : close())}
        title={editing ? "Edit event" : "Create event"}
        description={
          step === 1 ? "Step 1 of 2: name the event" : "Step 2 of 2: how Routely knows it happened"
        }
        busy={saving}
        width={680}
      >
        {step === 1 ? (
          <StepOne
            form={form}
            errors={errors}
            patch={patch}
            nameLocked={nameLocked}
            received={!editing && !!event}
          />
        ) : (
          <StepTwo
            form={form}
            errors={errors}
            patch={patch}
            manual={manual}
            setManual={setManual}
            onOpenPicker={openPicker}
          />
        )}
        {formError ? (
          <div className="px-6 pb-4 max-[641px]:px-4">
            <ErrorLine alert>{formError}</ErrorLine>
          </div>
        ) : null}
        <ModalFooter>
          {step === 1 ? (
            <>
              <button type="button" className={btn.secondary} onClick={close}>
                Cancel
              </button>
              <button type="button" className={btn.primary} onClick={next}>
                Next
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={btn.secondary}
                onClick={() => setStep(1)}
                disabled={saving}
              >
                Back
              </button>
              <button
                type="button"
                className={btn.primary}
                onClick={() => void save()}
                disabled={saving}
                aria-busy={saving}
              >
                {saving ? <Spinner size={14} /> : null}
                {saving ? "Saving…" : editing ? "Save changes" : "Create event"}
              </button>
            </>
          )}
        </ModalFooter>
      </Modal>

      {picking ? (
        <ElementPicker
          websiteId={websiteId}
          pageUrl={withScheme(form.pageUrl)}
          target={form.method === "FORM" ? "form" : "click"}
          installHref={installHref}
          onUse={usePicked}
          onCancel={() => setPicking(false)}
          onManual={() => {
            setPicking(false);
            setManual(true);
          }}
        />
      ) : null}
    </>
  );
}

/** A saved event proves nothing yet: only one that arrives does. */
function savedNote(editing: boolean, code: boolean): string {
  const state = editing
    ? "Routely hasn’t seen it work with this setup yet."
    : "It’s created, but Routely hasn’t detected it yet.";
  const next = code
    ? "Add the code to your site, perform the action, then refresh the list."
    : "Perform the action on your site, then refresh the list.";
  return `${state} ${next}`;
}

function StepOne({
  form,
  errors,
  patch,
  nameLocked,
  received,
}: {
  form: EventForm;
  errors: Errors;
  patch(next: Partial<EventForm>): void;
  nameLocked: boolean;
  /** A name that already arrived, being set up. */
  received: boolean;
}) {
  const categories = useId();
  return (
    <ModalBody>
      <Field
        id="ev-name"
        label="Event name"
        error={errors.name}
        hint={
          nameLocked
            ? "A launched experiment uses this event, so its name can’t change."
            : received
              ? "Keep this name to count what has already arrived."
              : EVENT_NAME_HINT
        }
      >
        {(aria) => (
          <input
            {...aria}
            type="text"
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            readOnly={nameLocked}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            placeholder="apply_button_clicked"
            className={cn(input, mono, nameLocked && "bg-[#F9FAFB] text-[#6B7280]")}
          />
        )}
      </Field>
      <Field id="ev-description" label="Description (optional)" error={errors.description}>
        {(aria) => (
          <input
            {...aria}
            type="text"
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            maxLength={300}
            placeholder="Someone clicks Apply on the pricing page"
            className={input}
          />
        )}
      </Field>
      <Field id="ev-category" label="Category (optional)" error={errors.category}>
        {(aria) => (
          <>
            <input
              {...aria}
              type="text"
              list={categories}
              value={form.category}
              onChange={(e) => patch({ category: e.target.value })}
              maxLength={60}
              placeholder="Lead"
              className={input}
            />
            <datalist id={categories}>
              {CATEGORIES.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </>
        )}
      </Field>
    </ModalBody>
  );
}

function StepTwo({
  form,
  errors,
  patch,
  manual,
  setManual,
  onOpenPicker,
}: {
  form: EventForm;
  errors: Errors;
  patch(next: Partial<EventForm>): void;
  manual: boolean;
  setManual(open: boolean): void;
  onOpenPicker(): void;
}) {
  const chooser = (target: "click" | "form") => (
    <ElementChooser
      target={target}
      form={form}
      errors={errors}
      patch={patch}
      manual={manual}
      setManual={setManual}
      onOpenPicker={onOpenPicker}
    />
  );

  return (
    <ModalBody>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={cn(labelClass, "mb-2 p-0")}>How should Routely track it?</legend>
        <div className="grid grid-cols-3 gap-2.5 max-[641px]:grid-cols-1">
          {METHODS.map((method) => (
            <Choice
              key={method.value}
              group="ev-method"
              on={form.method === method.value}
              // A button's selector can't identify a form, or the reverse.
              onSelect={() =>
                patch({ method: method.value, selector: "", elementLabel: null, picked: false })
              }
              title={METHOD_LABELS[method.value]}
              note={method.note}
            />
          ))}
        </div>
      </fieldset>

      {form.method === "CLICK" ? (
        <>
          {chooser("click")}
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={form.pageMatch !== null}
              onChange={(e) => patch({ pageMatch: e.target.checked ? "EXACT" : null })}
              className="m-0 mt-px size-[18px] flex-none"
              style={{ accentColor: ACCENT }}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[14px] leading-5 text-[#374151]">Only on this page</span>
              <span className={help}>
                Off, it counts on every page with this element. Split URL tests usually want every
                page, so both versions are counted.
              </span>
            </span>
          </label>
        </>
      ) : null}

      {form.method === "FORM" ? (
        <>
          {chooser("form")}
          <FormSuccess form={form} errors={errors} patch={patch} />
        </>
      ) : null}

      {form.method === "CODE" ? (
        <>
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Element (optional)</span>
            <p className={help}>
              Select the element it happens on to get a ready Google Tag Manager script for it.
            </p>
          </div>
          {chooser("click")}
          <CodeInstructions name={form.name.trim()} selector={form.selector.trim()} />
        </>
      ) : null}
    </ModalBody>
  );
}

/** The page, the picker button, and the manual selector as the secondary path. */
function ElementChooser({
  target,
  form,
  errors,
  patch,
  manual,
  setManual,
  onOpenPicker,
}: {
  target: "click" | "form";
  form: EventForm;
  errors: Errors;
  patch(next: Partial<EventForm>): void;
  manual: boolean;
  setManual(open: boolean): void;
  onOpenPicker(): void;
}) {
  const noun = target === "form" ? "form" : "element";
  const selector = form.selector.trim();

  return (
    <div className="flex flex-col gap-3">
      <Field id="ev-page" label={`Page with the ${noun}`} error={errors.pageUrl}>
        {(aria) => (
          <input
            {...aria}
            type="url"
            inputMode="url"
            value={form.pageUrl}
            // A selector chosen on one page says nothing about another.
            onChange={(e) => patch({ pageUrl: e.target.value, picked: false, elementLabel: null })}
            autoComplete="off"
            spellCheck={false}
            className={input}
          />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onOpenPicker}
          className={cn(btn.secondary, "self-start max-[641px]:h-11 max-[641px]:self-stretch")}
        >
          {selector ? `Choose a different ${noun}` : `Select ${noun}`}
        </button>
        {selector ? (
          <div className="flex flex-col gap-0.5 rounded-lg border border-[#EEF0F3] bg-[#FAFBFC] px-3 py-2.5">
            <span className="text-[13px] leading-[18px] font-semibold [overflow-wrap:anywhere] text-[#111827]">
              {form.elementLabel ?? (target === "form" ? "Your form" : "Your element")}
            </span>
            <code
              className={cn(
                mono,
                "text-[12px] leading-[17px] [overflow-wrap:anywhere] text-[#4B5563]",
              )}
            >
              {selector}
            </code>
          </div>
        ) : null}
        {errors.selector ? <ErrorLine>{errors.selector}</ErrorLine> : null}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={manual}
          onClick={() => setManual(!manual)}
          className={cn(btn.link, "h-auto gap-1 self-start px-0")}
        >
          <ChevronDownIcon
            size={14}
            className={cn("transition-transform", !manual && "-rotate-90")}
          />
          Advanced: enter a CSS selector by hand
        </button>
        {manual ? (
          <Field
            id="ev-selector"
            label="CSS selector"
            hint={`For people who know CSS. Selecting the ${noun} above is safer: Routely checks the selector matches it.`}
          >
            {(aria) => (
              <input
                {...aria}
                type="text"
                value={form.selector}
                onChange={(e) =>
                  patch({ selector: e.target.value, picked: false, elementLabel: null })
                }
                maxLength={500}
                autoComplete="off"
                spellCheck={false}
                placeholder={target === "form" ? "#contact-form" : "#apply-button"}
                className={cn(input, mono)}
              />
            )}
          </Field>
        ) : null}
      </div>
    </div>
  );
}

const MATCHES: { value: UrlMatch; label: string }[] = [
  { value: "EXACT", label: "Exact page" },
  { value: "PREFIX", label: "Starts with" },
];

function FormSuccess({
  form,
  errors,
  patch,
}: {
  form: EventForm;
  errors: Errors;
  patch(next: Partial<EventForm>): void;
}) {
  const hasForm = !!form.selector.trim();
  const option = (
    success: SuccessChoice,
    title: string,
    note: string,
    details?: ReactNode,
    badge?: string,
  ) => (
    <Choice
      group="ev-success"
      on={form.success === success}
      onSelect={() => patch({ success })}
      title={title}
      note={note}
      badge={badge}
    >
      {details}
    </Choice>
  );

  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className={cn(labelClass, "mb-2 p-0")}>How do we know it worked?</legend>
      {errors.formSuccess ? <ErrorLine>{errors.formSuccess}</ErrorLine> : null}

      {option(
        "URL",
        "Success page",
        "Visitors land on a thank-you page after sending the form.",
        <>
          <div className="flex gap-2 max-[641px]:flex-col">
            <Field
              id="ev-success-url"
              label="Success page address"
              error={errors.successUrl}
              className="min-w-0 flex-auto"
            >
              {(aria) => (
                <input
                  {...aria}
                  type="url"
                  inputMode="url"
                  value={form.successUrl}
                  onChange={(e) => patch({ successUrl: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://example.com/thank-you"
                  className={input}
                />
              )}
            </Field>
            <Field id="ev-success-match" label="Match" className="flex-none">
              {(aria) => (
                <select
                  {...aria}
                  value={form.successMatch}
                  onChange={(e) => patch({ successMatch: e.target.value as UrlMatch })}
                  className={cn(input, "w-[132px] max-[641px]:w-full")}
                >
                  {MATCHES.map((match) => (
                    <option key={match.value} value={match.value}>
                      {match.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <p className={help}>
            {hasForm
              ? "Counts a visit to this page within 30 minutes of sending this form."
              : "With no form chosen above, any first visit to this page in a session counts."}
          </p>
        </>,
        "Recommended",
      )}

      {option(
        "ELEMENT",
        "Success message",
        "A message appears on the same page after sending.",
        <SuccessMessage form={form} errors={errors} patch={patch} />,
      )}
    </fieldset>
  );
}

/**
 * The success message, found without a selector by default (user request 2026-11-10): the SDK
 * counts new text that appears around the chosen form after sending, unless an error shows. A
 * selector, under Advanced, makes it exact.
 */
function SuccessMessage({
  form,
  errors,
  patch,
}: {
  form: EventForm;
  errors: Errors;
  patch(next: Partial<EventForm>): void;
}) {
  const [advanced, setAdvanced] = useState(!!form.successSelector.trim());
  return (
    <>
      <p className={help}>
        No setup needed: after the form is sent, Routely counts it when a new message appears in or
        next to the form within 15 seconds. It doesn’t count while an error shows.
      </p>
      <button
        type="button"
        aria-expanded={advanced}
        onClick={() => setAdvanced(!advanced)}
        className={cn(btn.link, "h-auto gap-1 self-start px-0")}
      >
        <ChevronDownIcon
          size={14}
          className={cn("transition-transform", !advanced && "-rotate-90")}
        />
        Advanced: enter the message’s CSS selector
      </button>
      {advanced ? (
        <Field
          id="ev-success-selector"
          label="Success message selector (optional)"
          error={errors.successSelector}
          hint="For an exact match. The message must stay hidden until the form succeeds, and show within 15 seconds."
        >
          {(aria) => (
            <input
              {...aria}
              type="text"
              value={form.successSelector}
              onChange={(e) => patch({ successSelector: e.target.value })}
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
              placeholder=".form-success"
              className={cn(input, mono)}
            />
          )}
        </Field>
      ) : null}
    </>
  );
}

/** A JavaScript event: one snippet to start from, the other examples folded away until wanted. */
function CodeInstructions({ name, selector = "" }: { name: string; selector?: string }) {
  const [more, setMore] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {selector ? (
        <Snippet
          title="Track this element with the following JavaScript"
          note="Add it in Google Tag Manager as a Custom HTML tag with the All Pages trigger, then Submit and Publish. It counts each click on the selected element. The Routely script must be on the page too."
          code={elementTrackScript(name, selector)}
        />
      ) : (
        <Snippet
          title="Track this event with the following JavaScript"
          note="Run it right after the action succeeds (a signup, a purchase), not when the button is pressed. It works on your page or in a Google Tag Manager Custom HTML tag."
          code={trackScript(name)}
        />
      )}

      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore(!more)}
        className={cn(btn.link, "h-auto gap-1 self-start px-0")}
      >
        <ChevronDownIcon size={14} className={cn("transition-transform", !more && "-rotate-90")} />
        More examples
      </button>
      {more ? (
        <div className="flex flex-col gap-3 border-l-2 border-[#EEF0F3] pl-3">
          <p className={help}>
            Each needs the <code className={mono}>window.rtq = …</code> line from the snippet above
            to run first on the page.
          </p>
          <Snippet title="Send details" code={detailsSnippet(name)} />
          <Snippet title="Inside a form handler" code={handleSubmitSnippet(name)} />
          <Snippet
            title="Count a repeat once"
            note="A unique id as the third argument: a retry or a refresh with the same id isn’t counted again."
            code={idempotentSnippet(name)}
          />
          <p className={help}>
            Never send passwords, card data, emails, phone numbers or names as details. Routely
            drops them. Up to {MAX_EVENT_PROPERTIES} details per event.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Snippet({ title, note, code }: { title: string; note?: string; code: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={labelClass}>{title}</span>
      {note ? <p className={help}>{note}</p> : null}
      <CodeBlock code={code} label={`Copy: ${title}`} />
    </div>
  );
}

/** A radio tile, with what the choice needs opened beneath it once chosen. */
function Choice({
  group,
  on,
  onSelect,
  title,
  note,
  badge,
  children,
}: {
  group: string;
  on: boolean;
  onSelect(): void;
  title: string;
  note: string;
  badge?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-xl border-[1.5px] hover:border-[#B3DBFF]",
        on ? "border-[#0070C9] bg-[#F0F7FF]" : "border-[#E5E7EB] bg-white",
      )}
    >
      <label className="flex cursor-pointer items-start gap-2.5 p-3">
        <input
          type="radio"
          name={group}
          checked={on}
          onChange={onSelect}
          className="m-0 mt-px size-[18px] flex-none"
          style={{ accentColor: ACCENT }}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] leading-5 font-semibold text-[#111827]">{title}</span>
            {badge ? (
              <span className="inline-flex h-5 items-center rounded-md bg-[#DCFCE7] px-1.5 text-[12px] font-semibold text-[#166534]">
                {badge}
              </span>
            ) : null}
          </span>
          <span className="text-[13px] leading-[19px] text-[#6B7280]">{note}</span>
        </span>
      </label>
      {on && children ? (
        <div className="flex min-w-0 flex-col gap-2.5 px-3 pb-3">{children}</div>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children(aria: {
    id: string;
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
  }): ReactNode;
}) {
  const described = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": described.join(" ") || undefined,
      })}
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
      {hint ? (
        <p id={`${id}-hint`} className={help}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function ErrorLine({
  id,
  alert = false,
  children,
}: {
  id?: string;
  alert?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      role={alert ? "alert" : undefined}
      className={cn(errorText, "flex items-start gap-1.5")}
    >
      <AlertCircleIcon size={14} className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}

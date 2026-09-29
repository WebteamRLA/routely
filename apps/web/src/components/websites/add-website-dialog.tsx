"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Field } from "@/components/common/field";
import { SubmitButton } from "@/components/common/submit-button";
import { AttachSheetControls } from "@/components/integrations/attach-sheet-controls";
import { DomainField } from "@/components/websites/domain-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SiteProtocol } from "@/generated/prisma/enums";
import { routes } from "@/lib/routes";
import {
  attachPickedSheetAction,
  createSheetAction,
  getPickerTokenAction,
  listWorksheetsAction,
} from "@/server/actions/integration.actions";
import {
  createWebsiteInlineAction,
  type CreateWebsiteInlineState,
} from "@/server/actions/website.actions";

const IDLE: CreateWebsiteInlineState = { status: "idle" };

/**
 * Enables the optional "attach a Google Sheet" step after the website is created.
 *
 * Opt-in rather than always-on, because two callers must not have it: the experiment wizard, which
 * closes this dialog immediately and appends the new website to a picker, and the new-experiment
 * page, which does the same. Adding a step there would interrupt a flow that is about experiments,
 * not spreadsheets.
 */
export interface SheetStepConfig {
  /** Whether the account already holds a Google grant. False shows a link to connect one. */
  connected: boolean;
  developerKey?: string;
  projectNumber?: string;
}

export interface CreatedWebsite {
  id: string;
  name: string;
  domain: string;
  protocol: SiteProtocol;
  /** Needed by anything that offers pixel setup for a freshly created website. */
  publicSiteId: string;
}

const DEFAULT_TRIGGER = (
  <button
    type="button"
    className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
  >
    <Plus className="size-3.5" aria-hidden />
    Add another website
  </button>
);

/**
 * The form half, deliberately split from the dialog.
 *
 * It owns the action and reports success upward; the dialog owns whether it is open. Keeping
 * those in separate components is what lets the success path live in an effect without any
 * component setting its *own* state there — closing is the parent's business, and a child
 * calling a parent's callback from an effect is ordinary React.
 */
function AddWebsiteForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (website: CreatedWebsite) => void;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(createWebsiteInlineAction, IDLE);
  useFormToast(state);

  // Which result has already been acted on. A ref rather than state: this drives no rendering,
  // and it keeps the effect idempotent when it re-runs because `onSuccess` changed identity
  // rather than because a new result arrived.
  const handledRef = useRef(state);

  useEffect(() => {
    if (handledRef.current === state) return;
    handledRef.current = state;

    if (state.status === "success" && state.website) {
      onSuccess(state.website);
    }
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-5">
      <Field
        name="name"
        label="Name"
        hint="Only used to identify this website inside Routely."
        errors={state.fieldErrors?.["name"]}
      >
        {(props) => (
          <Input {...props} placeholder="Acme Store" maxLength={120} autoComplete="off" required />
        )}
      </Field>

      <DomainField errors={state.fieldErrors?.["domain"]} />

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton pendingLabel="Adding…">Add website</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Website creation as a popup rather than a page — there is no standalone `/websites/new`
 * route. Uses `createWebsiteInlineAction` rather than `createWebsiteAction` because that one
 * redirects to the new website's own page on success, which would navigate away from wherever
 * this dialog was opened.
 *
 * Without an `onCreated` callback (the plain "add a website" case, e.g. the table header) the
 * dialog falls back to `router.refresh()` so the server page re-renders with the new website
 * present. Callers that need the created row directly — the experiment wizard, which appends it
 * to a website picker without a round trip — pass `onCreated` instead.
 */
export function AddWebsiteDialog({
  onCreated,
  trigger = DEFAULT_TRIGGER,
  sheetStep,
}: {
  onCreated?: (website: CreatedWebsite) => void;
  trigger?: React.ReactNode;
  /** When given, the dialog offers a Google Sheet for the new website before closing. */
  sheetStep?: SheetStepConfig;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedWebsite | null>(null);

  // Remounts the form on each open so its action state starts fresh. Without this, the result
  // of the previous submission would still be showing — and a second website could not be
  // added, because the form would open already holding a success.
  const [session, setSession] = useState(0);

  function handleOpenChange(next: boolean) {
    if (next) {
      setSession((value) => value + 1);
      setCreated(null);
    }
    setOpen(next);

    // Closing after the sheet step — by the X, Escape or a click outside — still has to refresh, or
    // the page behind would not show the website that was created.
    if (!next && created && !onCreated) router.refresh();
  }

  function handleSuccess(website: CreatedWebsite) {
    // A caller that wants the created row takes it immediately; the sheet step is not for them.
    if (onCreated) {
      setOpen(false);
      onCreated(website);
      return;
    }

    if (sheetStep) {
      setCreated(website);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  function finishSheetStep() {
    setOpen(false);
    setCreated(null);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-md">
        {created && sheetStep ? (
          <>
            <DialogHeader>
              <DialogTitle>Send {created.name}&rsquo;s results to Google Sheets?</DialogTitle>
              <DialogDescription>
                Optional. Routely will append yesterday&rsquo;s results to this website&rsquo;s own
                spreadsheet once a day. You can set this up later from the website&rsquo;s page.
              </DialogDescription>
            </DialogHeader>

            {sheetStep.connected ? (
              <AttachSheetControls
                compact
                websiteId={created.id}
                developerKey={sheetStep.developerKey}
                projectNumber={sheetStep.projectNumber}
                getPickerToken={getPickerTokenAction}
                attachSheet={attachPickedSheetAction}
                listWorksheets={listWorksheetsAction}
                createSheetAction={createSheetAction}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect your Google account once on the{" "}
                <a href={routes.integrations} className="font-medium underline">
                  Integrations
                </a>{" "}
                page, then you can attach a spreadsheet to this website without signing in again.
              </p>
            )}

            <div className="flex justify-end pt-1">
              {/* "Done" rather than "Skip": the website is already created, so this button closes a
               * finished flow rather than abandoning one. */}
              <Button type="button" onClick={finishSheetStep}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add a website</DialogTitle>
              <DialogDescription>
                A website groups your experiments and gives you one tracking snippet to install.
              </DialogDescription>
            </DialogHeader>

            <AddWebsiteForm
              key={session}
              onSuccess={handleSuccess}
              onCancel={() => setOpen(false)}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Field } from "@/components/common/field";
import { SubmitButton } from "@/components/common/submit-button";
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
import {
  createWebsiteInlineAction,
  type CreateWebsiteInlineState,
} from "@/server/actions/website.actions";

const IDLE: CreateWebsiteInlineState = { status: "idle" };

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
  open: controlledOpen,
  onOpenChange,
}: {
  onCreated?: (website: CreatedWebsite) => void;
  /** Omitted (`null`) when the dialog is opened from elsewhere through `open`. */
  trigger?: React.ReactNode | null;
  /** Controlled mode, for an opener that unmounts as it opens the dialog (the sidebar's
   * website menu closes when an item is chosen, and would take an inner trigger with it). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  // Remounts the form on each open so its action state starts fresh. Without this, the result
  // of the previous submission would still be showing — and a second website could not be
  // added, because the form would open already holding a success.
  const [session, setSession] = useState(0);

  function handleOpenChange(next: boolean) {
    setOpen(next);
  }

  // Bumped on each transition to open, whether it came through the trigger or from a
  // controlling parent — a controlled open never passes through `handleOpenChange`.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((value) => value + 1);
  }

  function handleSuccess(website: CreatedWebsite) {
    setOpen(false);

    if (onCreated) {
      onCreated(website);
      return;
    }

    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger === null ? null : <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a website</DialogTitle>
          <DialogDescription>
            A website groups your experiments and gives you one tracking snippet to install.
          </DialogDescription>
        </DialogHeader>

        <AddWebsiteForm key={session} onSuccess={handleSuccess} onCancel={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

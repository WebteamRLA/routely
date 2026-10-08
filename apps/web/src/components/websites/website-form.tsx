"use client";

import { useActionState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import Link from "next/link";

import { Field } from "@/components/common/field";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DomainField } from "@/components/websites/domain-field";
import type { SiteProtocol } from "@/generated/prisma/enums";
import { IDLE, type FormState } from "@/lib/form-state";

/**
 * Create/edit form for a website.
 *
 * One component serves both cases: the caller supplies the action and the existing values.
 * Errors come back from the server through `useActionState` rather than being duplicated in
 * client-side validation — the server's Zod schema is the only definition of what is valid,
 * so the two can never disagree.
 */
export function WebsiteForm({
  action,
  websiteId,
  defaultName = "",
  defaultDomain = "",
  defaultProtocol = "HTTPS",
  submitLabel,
  pendingLabel,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Present when editing; sent back so the action knows which website to update. */
  websiteId?: string;
  defaultName?: string;
  defaultDomain?: string;
  defaultProtocol?: SiteProtocol;
  submitLabel: string;
  pendingLabel: string;
  cancelHref?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  useFormToast(state);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {websiteId ? <input type="hidden" name="websiteId" value={websiteId} /> : null}

      {/* Side by side where there is room, as the design's settings fields are. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] items-start gap-3.5">
        <Field
          name="name"
          label="Name"
          hint="Only used to identify this website inside Routely."
          errors={state.fieldErrors?.["name"]}
        >
          {(props) => (
            <Input
              {...props}
              defaultValue={defaultName}
              placeholder="Acme Store"
              maxLength={120}
              autoComplete="off"
              required
            />
          )}
        </Field>

        <DomainField
          defaultProtocol={defaultProtocol}
          defaultDomain={defaultDomain}
          errors={state.fieldErrors?.["domain"]}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
        {cancelHref ? (
          <Button variant="ghost" asChild>
            <Link href={cancelHref}>Cancel</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}

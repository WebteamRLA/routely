"use client";

import { useActionState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/common/submit-button";
import { isPickerConfigured, pickSpreadsheet } from "@/components/integrations/google-picker";
import { Button } from "@/components/ui/button";
import { useFormToast } from "@/hooks/use-form-toast";
import { IDLE, type FormState } from "@/lib/form-state";
import type { AttachResult, PickerTokenResult } from "@/server/actions/integration.actions";

/**
 * The two ways to give a website a spreadsheet: pick an existing one, or have Routely create one.
 *
 * Picking goes through Google's own Picker window, which is what keeps Routely on the non-sensitive
 * `drive.file` scope — the customer sees their whole Drive, Google hands back only the file they
 * chose, and Routely never gains the ability to enumerate their files.
 *
 * Neither path asks which *tab* to use. Routely creates and owns a tab inside the chosen
 * spreadsheet, because every refresh overwrites that tab wholesale — pointing it at a tab holding
 * the customer's own work would destroy it. That also removes a question most people could not
 * answer meaningfully about a spreadsheet they just created.
 */
export function AttachSheetControls({
  websiteId,
  developerKey,
  projectNumber,
  getPickerToken,
  attachSheet,
  createSheetAction,
  compact = false,
}: {
  websiteId: string;
  developerKey?: string;
  projectNumber?: string;
  getPickerToken: () => Promise<PickerTokenResult>;
  attachSheet: (input: { websiteId: string; spreadsheetId: string }) => Promise<AttachResult>;
  createSheetAction: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Tighter layout for use inside a dialog. */
  compact?: boolean;
}) {
  const [createState, createFormAction] = useActionState(createSheetAction, IDLE);
  useFormToast(createState);

  const [isPicking, startPicking] = useTransition();

  const pickerAvailable = isPickerConfigured(developerKey, projectNumber);

  function openPicker() {
    startPicking(async () => {
      const token = await getPickerToken();

      if (!token.ok) {
        toast.error(token.message);
        return;
      }

      let picked;

      try {
        picked = await pickSpreadsheet({
          accessToken: token.accessToken,
          developerKey: developerKey as string,
          appId: projectNumber as string,
        });
      } catch (error) {
        // A blocked script is the likely cause, and not something the customer can fix from here —
        // so the message points at the alternative that does work.
        toast.error(
          error instanceof Error
            ? `${error.message} You can still create a new spreadsheet instead.`
            : "Google's file picker could not be opened.",
        );
        return;
      }

      // Cancelled. Nothing to say — they closed a window on purpose.
      if (!picked) return;

      const result = await attachSheet({ websiteId, spreadsheetId: picked.spreadsheetId });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(`Writing to the “${result.sheetTitle}” tab in ${result.spreadsheetName}.`);
    });
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div className="flex flex-wrap gap-2">
        {pickerAvailable ? (
          <Button
            type="button"
            variant="outline"
            className="border-primary text-primary"
            onClick={openPicker}
            disabled={isPicking}
          >
            {isPicking ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Choose existing sheet
          </Button>
        ) : null}

        <form action={createFormAction}>
          <input type="hidden" name="websiteId" value={websiteId} />
          <SubmitButton variant={pickerAvailable ? "outline" : "default"} pendingLabel="Creating…">
            + Create new sheet
          </SubmitButton>
        </form>
      </div>

      <p className="text-[12.5px] text-ink-3">
        Routely adds a tab called &ldquo;Routely&rdquo; and keeps it up to date. Nothing else in the
        spreadsheet is touched.
      </p>

      {!pickerAvailable ? (
        <p className="text-[12.5px] text-ink-3">
          Choosing an existing spreadsheet needs{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_GOOGLE_API_KEY</code> and{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER</code> to be
          configured. Creating a new one works without them.
        </p>
      ) : null}
    </div>
  );
}

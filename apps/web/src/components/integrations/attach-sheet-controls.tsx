"use client";

import { useActionState, useState, useTransition } from "react";
import { FilePlus2, FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/common/submit-button";
import { isPickerConfigured, pickSpreadsheet } from "@/components/integrations/google-picker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormToast } from "@/hooks/use-form-toast";
import { IDLE, type FormState } from "@/lib/form-state";
import type {
  AttachResult,
  PickerTokenResult,
  WorksheetListResult,
} from "@/server/actions/integration.actions";

/**
 * The two ways to give a website a spreadsheet: pick an existing one, or have Routely create one.
 *
 * Picking goes through Google's own Picker window, which is what keeps Routely on the non-sensitive
 * `drive.file` scope — the customer sees their whole Drive, Google hands back only the file they
 * chose, and Routely never gains the ability to enumerate their files. See
 * `components/integrations/google-picker.ts`.
 *
 * Creating needs no picker at all: a file this app creates is a file it may write to under the same
 * scope.
 *
 * After a spreadsheet is chosen, its tabs are fetched so the customer can say **which** tab to append
 * to. Most spreadsheets have one, so the common case resolves itself and the select only appears when
 * there is a real choice to make.
 */
export function AttachSheetControls({
  websiteId,
  developerKey,
  projectNumber,
  getPickerToken,
  attachSheet,
  listWorksheets,
  createSheetAction,
  compact = false,
}: {
  websiteId: string;
  developerKey?: string;
  projectNumber?: string;
  getPickerToken: () => Promise<PickerTokenResult>;
  attachSheet: (input: {
    websiteId: string;
    spreadsheetId: string;
    sheetId: number;
  }) => Promise<AttachResult>;
  listWorksheets: (spreadsheetId: string) => Promise<WorksheetListResult>;
  createSheetAction: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Tighter layout for use inside a dialog. */
  compact?: boolean;
}) {
  const [createState, createFormAction] = useActionState(createSheetAction, IDLE);
  useFormToast(createState);

  const [isPicking, startPicking] = useTransition();
  const [isAttaching, startAttaching] = useTransition();
  const [chosen, setChosen] = useState<{
    spreadsheetId: string;
    spreadsheetName: string;
    worksheets: { sheetId: number; title: string }[];
  } | null>(null);
  const [sheetId, setSheetId] = useState<string>("");

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
        // A blocked script is the likely cause, and it is not something the customer can fix from
        // here — so the message points at the alternative that does work.
        toast.error(
          error instanceof Error
            ? `${error.message} You can still create a new spreadsheet instead.`
            : "Google's file picker could not be opened.",
        );
        return;
      }

      // Cancelled. Nothing to say — they closed a window on purpose.
      if (!picked) return;

      const tabs = await listWorksheets(picked.spreadsheetId);

      if (!tabs.ok) {
        toast.error(tabs.message);
        return;
      }

      // One tab is the overwhelmingly common case, so attach immediately rather than asking a
      // question with a single answer.
      if (tabs.worksheets.length === 1) {
        await attach(picked.spreadsheetId, tabs.worksheets[0]?.sheetId as number);
        return;
      }

      setChosen({
        spreadsheetId: tabs.spreadsheetId,
        spreadsheetName: tabs.spreadsheetName,
        worksheets: tabs.worksheets,
      });
      setSheetId("");
    });
  }

  async function attach(spreadsheetId: string, gid: number) {
    const result = await attachSheet({ websiteId, spreadsheetId, sheetId: gid });

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    toast.success(`Writing to “${result.sheetTitle}” in ${result.spreadsheetName}.`);
    setChosen(null);
    setSheetId("");
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div className="flex flex-wrap gap-2">
        {pickerAvailable ? (
          <Button type="button" variant="outline" onClick={openPicker} disabled={isPicking}>
            {isPicking ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <FolderOpen aria-hidden />
            )}
            Choose existing sheet
          </Button>
        ) : null}

        <form action={createFormAction}>
          <input type="hidden" name="websiteId" value={websiteId} />
          <SubmitButton
            variant={pickerAvailable ? "secondary" : "default"}
            pendingLabel="Creating…"
          >
            <FilePlus2 aria-hidden />
            Create new sheet
          </SubmitButton>
        </form>
      </div>

      {!pickerAvailable ? (
        <p className="text-xs text-muted-foreground">
          Choosing an existing spreadsheet needs <code>NEXT_PUBLIC_GOOGLE_API_KEY</code> and{" "}
          <code>NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER</code> to be configured. Creating a new one works
          without them.
        </p>
      ) : null}

      {chosen ? (
        <div className="space-y-2 rounded-md border border-border/70 p-3">
          <p className="text-sm">
            <span className="font-medium">{chosen.spreadsheetName}</span> has several tabs. Which
            one should Routely append to?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sheetId} onValueChange={setSheetId}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="Choose a tab" />
              </SelectTrigger>
              <SelectContent>
                {chosen.worksheets.map((worksheet) => (
                  <SelectItem key={worksheet.sheetId} value={String(worksheet.sheetId)}>
                    {worksheet.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={!sheetId || isAttaching}
              onClick={() =>
                startAttaching(async () => {
                  await attach(chosen.spreadsheetId, Number(sheetId));
                })
              }
            >
              {isAttaching ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Use this tab
            </Button>
            <Button type="button" variant="ghost" onClick={() => setChosen(null)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Rows are appended to the bottom of the tab. Nothing already in it is changed.
          </p>
        </div>
      ) : null}
    </div>
  );
}

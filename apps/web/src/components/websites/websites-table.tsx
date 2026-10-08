"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import Link from "next/link";
import { Loader2, Trash2 } from "lucide-react";

import { PixelSetupDialog } from "@/components/get-started/pixel-setup-dialog";
import { AddWebsiteDialog } from "@/components/websites/add-website-dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IDLE, type FormState } from "@/lib/form-state";
import { routes } from "@/lib/routes";
import { PIXEL_STATUS } from "@/lib/pixel-status";
import { cn } from "@/lib/utils";
import type { WebsiteWithStatus } from "@/server/services/website.service";

/**
 * Every website in one table: its pixel status, how many experiments it has, and the actions
 * that move it forward — plus row selection for deleting several at once.
 *
 * Replaces a row of selector chips that scoped the whole page to one website at a time. With
 * more than two or three websites that shape hid the thing people come here to check — which
 * sites are reporting and which are quiet — behind a click each.
 */

/**
 * One grid definition shared by the header and every row, so the columns cannot drift apart.
 *
 * The action column is a fixed width rather than `auto` on purpose: each row is its own grid,
 * so an auto track would size to that row's own buttons and every row would land in a slightly
 * different place.
 */
const ROW_GRID =
  "grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 lg:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,1.8fr)_88px_17rem] lg:items-center lg:gap-x-3.5";

/**
 * A stable colour per website, so a row keeps its identity as others come and go. Derived from
 * the id rather than list position, which would reshuffle every colour whenever a website is
 * created or deleted.
 */
const AVATAR_COLORS = ["bg-arm-a", "bg-coral", "bg-arm-c", "bg-arm-d", "bg-navy", "bg-arm-control"];

function avatarColor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 2147483647;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

function WebsiteRow({
  entry,
  selected,
  onSelectedChange,
  sdkUrl,
  verifyAction,
}: {
  entry: WebsiteWithStatus;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  sdkUrl: string;
  verifyAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const { website, pixelStatus, experiments } = entry;
  const status = PIXEL_STATUS[pixelStatus];

  return (
    <div
      className={cn(
        ROW_GRID,
        "border-b border-divider px-[18px] py-[13px] transition-colors last:border-b-0",
        selected ? "bg-brand-tint" : "hover:bg-subtle",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(value) => onSelectedChange(value === true)}
        aria-label={"Select " + website.name}
      />

      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md font-heading text-[13px] font-bold text-white",
            avatarColor(website.id),
          )}
        >
          {website.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0">
          <Link
            href={routes.websites.detail(website.id)}
            className="block truncate text-[13.5px] font-bold outline-none hover:text-primary focus-visible:underline"
          >
            {website.name}
          </Link>
          <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-3">
            {website.domain}
          </span>
        </span>
      </div>

      {/* Below `lg` the grid is two columns, so these cells start a new row and would otherwise
          sit underneath the checkbox. */}
      <div className="col-start-2 min-w-0 lg:col-start-auto">
        <span
          className={cn(
            "inline-flex h-[22px] items-center gap-1.5 rounded-sm border px-2 text-[12px] font-bold whitespace-nowrap",
            status.positive
              ? "border-success-border bg-success-bg text-success-strong"
              : "border-warning-border bg-warning-bg text-warning-text",
          )}
        >
          <span aria-hidden className="text-[9px] leading-none">
            {status.positive ? "●" : "○"}
          </span>
          {status.label}
        </span>
        <span className="mt-1 block text-[12px] text-pretty text-ink-3">{status.hint}</span>
      </div>

      <div className="col-start-2 min-w-0 lg:col-start-auto lg:text-right">
        <span className="text-[13.5px] font-semibold tabular-nums">
          {experiments.active} running
        </span>
        <span className="mt-0.5 block text-[12px] text-ink-3 tabular-nums">
          {experiments.total === 0 ? "none created yet" : "of " + experiments.total + " total"}
        </span>
      </div>

      {/* Two equal tracks rather than a right-aligned flex row: "Re-check pixel" is wider than
          "Set up pixel", and right-aligning would let that width shift the neighbouring button
          left on whichever rows are already installed. */}
      <div className="col-start-2 grid grid-cols-2 gap-2 lg:col-start-auto">
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href={routes.experiments.new(website.id)}>New experiment</Link>
        </Button>
        <PixelSetupDialog
          website={website}
          sdkUrl={sdkUrl}
          verifyAction={verifyAction}
          triggerLabel={pixelStatus === "unknown" ? "Set up pixel" : "Re-check pixel"}
          triggerVariant={pixelStatus === "unknown" ? "default" : "outline"}
          alreadySetUp={pixelStatus !== "unknown"}
          pixelStatus={pixelStatus}
          triggerClassName="w-full"
        />
      </div>
    </div>
  );
}

/**
 * Confirmation for deleting the selected websites.
 *
 * Deleting a website cascades to every experiment, visitor, event and conversion beneath it, so
 * the dialog names what is actually lost rather than asking a generic "are you sure?". The form
 * lives outside the dialog with the confirm button associated by `form=`, because Radix only
 * mounts dialog content while open — a nested form would exist only transiently.
 */
function DeleteSelected({
  selectedEntries,
  action,
  onDeleted,
}: {
  selectedEntries: WebsiteWithStatus[];
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  onDeleted: () => void;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  const formId = "delete-selected-websites";

  useFormToast(state);

  /**
   * Clearing the selection has to happen in an effect, not in render: `onDeleted` updates the
   * table above this component, and React forbids updating another component mid-render. The
   * ref keeps it to once per result even if the effect re-runs for another reason.
   */
  const handledRef = useRef(state);

  useEffect(() => {
    if (handledRef.current === state) return;
    handledRef.current = state;
    if (state.status === "success") onDeleted();
  }, [state, onDeleted]);

  const experimentCount = selectedEntries.reduce((sum, entry) => sum + entry.experiments.total, 0);
  const plural = selectedEntries.length === 1 ? "" : "s";

  return (
    <>
      <form id={formId} action={formAction} className="hidden">
        {selectedEntries.map((entry) => (
          <input key={entry.website.id} type="hidden" name="websiteId" value={entry.website.id} />
        ))}
      </form>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive-outline" size="sm">
            <Trash2 aria-hidden />
            Delete {selectedEntries.length}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedEntries.length} website{plural}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {experimentCount > 0
                ? "This permanently deletes " +
                  experimentCount +
                  " experiment" +
                  (experimentCount === 1 ? "" : "s") +
                  " and every visitor, event and conversion recorded under them, along with the tracking snippets."
                : "This permanently deletes the selected websites and their tracking snippets."}{" "}
              It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <ul className="max-h-40 overflow-y-auto rounded-lg border border-divider text-[13.5px]">
            {selectedEntries.map((entry) => (
              <li
                key={entry.website.id}
                className="flex items-baseline gap-2 border-b border-divider px-3 py-2 last:border-b-0"
              >
                <span className="font-bold">{entry.website.name}</span>
                <span className="truncate font-mono text-[12px] text-ink-3">
                  {entry.website.domain}
                </span>
              </li>
            ))}
          </ul>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            {/* `useFormStatus` needs a descendant of the form, so pending state comes from
                `useActionState` instead — the button is associated, not nested. */}
            <Button type="submit" form={formId} variant="destructive" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function WebsitesTable({
  entries,
  sdkUrl,
  verifyAction,
  deleteAction,
}: {
  entries: WebsiteWithStatus[];
  sdkUrl: string;
  verifyAction: (state: FormState, formData: FormData) => Promise<FormState>;
  deleteAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Derived from the current rows rather than trusting the stored ids: a website deleted in
  // another tab disappears from `entries` on the next render, and its id must not linger in a
  // count or get submitted.
  const selectedEntries = entries.filter((entry) => selectedIds.includes(entry.website.id));
  const allSelected = entries.length > 0 && selectedEntries.length === entries.length;
  const someSelected = selectedEntries.length > 0 && !allSelected;

  // Only websites where nothing is known yet. A verified site awaiting its first experiment is
  // set up correctly and must not be counted as outstanding work.
  const quiet = entries.filter((entry) => entry.pixelStatus === "unknown").length;

  function toggle(websiteId: string, selected: boolean) {
    setSelectedIds((previous) =>
      selected ? [...previous, websiteId] : previous.filter((id) => id !== websiteId),
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="font-heading text-[14.5px] font-bold tracking-[-0.01em]">Websites</h2>
          <span className="text-[12.5px] text-ink-3 tabular-nums">{entries.length}</span>
          {selectedEntries.length > 0 ? (
            <span className="text-[12.5px] font-bold text-primary">
              {selectedEntries.length} selected
            </span>
          ) : quiet > 0 ? (
            <span className="text-[12.5px] font-bold text-warning-text">
              {quiet} still {quiet === 1 ? "needs" : "need"} setup
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {selectedEntries.length > 0 ? (
            <DeleteSelected
              selectedEntries={selectedEntries}
              action={deleteAction}
              onDeleted={() => setSelectedIds([])}
            />
          ) : null}
          <AddWebsiteDialog trigger={<Button size="sm">+ Add website</Button>} />
        </div>
      </header>

      {/* Column labels only where the row is laid out in columns. Below `lg` each row stacks
          and the values carry their own sub-labels instead — and with no rows at all there are
          no columns to label. */}
      <div
        className={cn(
          ROW_GRID,
          "table-head hidden border-b border-divider bg-subtle px-[18px] py-[9px]",
          entries.length > 0 && "lg:grid",
        )}
      >
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(value) =>
            setSelectedIds(value === true ? entries.map((entry) => entry.website.id) : [])
          }
          aria-label={allSelected ? "Deselect all websites" : "Select all websites"}
        />
        <span>Website</span>
        <span>Pixel status</span>
        <span className="text-right">Experiments</span>
        <span className="text-right">Actions</span>
      </div>

      {entries.length === 0 ? (
        /*
         * The empty case keeps the page's shape rather than replacing it. An account with no
         * websites yet is looking at the same dashboard it will have tomorrow, with one thing
         * missing and named — which reads as a starting point instead of as a different screen
         * that disappears once the first website exists.
         */
        <div className="flex flex-col items-start gap-3 px-5 py-7">
          <div className="space-y-1">
            <p className="text-[13.5px] font-bold">No websites yet</p>
            <p className="max-w-md text-[13.5px] text-pretty text-ink-3">
              Add a website to get its tracking snippet. Everything above fills in once it starts
              recording visitors.
            </p>
          </div>
          <AddWebsiteDialog trigger={<Button size="sm">+ Add website</Button>} />
        </div>
      ) : (
        <div>
          {entries.map((entry) => (
            <WebsiteRow
              key={entry.website.id}
              entry={entry}
              selected={selectedIds.includes(entry.website.id)}
              onSelectedChange={(selected) => toggle(entry.website.id, selected)}
              sdkUrl={sdkUrl}
              verifyAction={verifyAction}
            />
          ))}
        </div>
      )}
    </section>
  );
}

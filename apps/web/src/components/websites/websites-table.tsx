"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import Link from "next/link";
import {
  CheckCircle2,
  CircleAlert,
  FlaskConical,
  Globe,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
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
  "grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,2.2fr)_minmax(0,1.8fr)_minmax(0,1fr)_19rem] sm:items-center sm:gap-4";

/**
 * A stable colour per website, so a row keeps its identity as others come and go. Derived from
 * the id rather than list position, which would reshuffle every colour whenever a website is
 * created or deleted.
 */
const AVATAR_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-500",
  "bg-pink-600",
  "bg-cyan-600",
];

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
        "px-4 py-3.5 transition-colors",
        selected ? "bg-primary/5" : "hover:bg-muted/40",
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
            "grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold text-white",
            avatarColor(website.id),
          )}
        >
          {website.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0">
          <Link
            href={routes.websites.detail(website.id)}
            className="block truncate text-sm font-medium hover:underline"
          >
            {website.name}
          </Link>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {website.domain}
          </span>
        </span>
      </div>

      {/* Below `sm` the grid is two columns, so these cells start a new row and would otherwise
          sit underneath the checkbox. */}
      <div className="col-start-2 min-w-0 sm:col-start-auto">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-medium",
            status.positive
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-400",
          )}
        >
          {status.positive ? (
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          ) : (
            <CircleAlert className="size-4 shrink-0" aria-hidden />
          )}
          {status.label}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{status.hint}</span>
      </div>

      <div className="col-start-2 min-w-0 sm:col-start-auto">
        <span className="text-sm font-medium tabular-nums">{experiments.active} running</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {experiments.total === 0 ? "none created yet" : "of " + experiments.total + " total"}
        </span>
      </div>

      {/* Two equal tracks rather than a right-aligned flex row: "Re-check pixel" is wider than
          "Set up pixel", and right-aligning would let that width shift the neighbouring button
          left on whichever rows are already installed. */}
      <div className="col-start-2 grid grid-cols-2 gap-2 sm:col-start-auto">
        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link href={routes.experiments.new(website.id)}>
            <FlaskConical aria-hidden />
            New experiment
          </Link>
        </Button>
        <PixelSetupDialog
          website={website}
          sdkUrl={sdkUrl}
          verifyAction={verifyAction}
          triggerLabel={pixelStatus === "unknown" ? "Set up pixel" : "Re-check pixel"}
          triggerVariant={pixelStatus === "unknown" ? "default" : "outline"}
          alreadySetUp={pixelStatus !== "unknown"}
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
          <Button variant="destructive" size="sm">
            <Trash2 aria-hidden />
            Delete
            <Badge variant="secondary" className="ml-1">
              {selectedEntries.length}
            </Badge>
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

          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {selectedEntries.map((entry) => (
              <li key={entry.website.id} className="flex items-baseline gap-2">
                <span className="font-medium">{entry.website.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
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
    <section className="overflow-hidden rounded-xl border border-border/70">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/70 bg-muted/40 px-4 py-3">
        <h2 className="text-sm font-medium">Websites</h2>
        <Badge variant="secondary">{entries.length}</Badge>

        {selectedEntries.length > 0 ? (
          <span className="text-xs text-muted-foreground">{selectedEntries.length} selected</span>
        ) : quiet > 0 ? (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            {quiet} still {quiet === 1 ? "needs" : "need"} setup
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {selectedEntries.length > 0 ? (
            <DeleteSelected
              selectedEntries={selectedEntries}
              action={deleteAction}
              onDeleted={() => setSelectedIds([])}
            />
          ) : null}
          <AddWebsiteDialog
            trigger={
              <Button size="sm">
                <Plus aria-hidden />
                Add website
              </Button>
            }
          />
        </div>
      </header>

      {/* Column labels only where the row is laid out in columns. Below `sm` each row stacks
          and the values carry their own sub-labels instead — and with no rows at all there are
          no columns to label. */}
      <div
        className={cn(
          ROW_GRID,
          "hidden border-b border-border/70 px-4 py-2 text-xs font-medium text-muted-foreground",
          entries.length > 0 && "sm:grid",
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
        <span>Experiments</span>
        <span className="text-right">Actions</span>
      </div>

      {entries.length === 0 ? (
        /*
         * The empty case keeps the page's shape rather than replacing it. An account with no
         * websites yet is looking at the same dashboard it will have tomorrow, with one thing
         * missing and named — which reads as a starting point instead of as a different screen
         * that disappears once the first website exists.
         */
        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"
          >
            <Globe className="size-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">No websites yet</p>
            <p className="mx-auto max-w-sm text-sm text-balance text-muted-foreground">
              Add a website to get its tracking snippet. Everything above fills in once it starts
              recording visitors.
            </p>
          </div>
          <AddWebsiteDialog
            trigger={
              <Button size="sm">
                <Plus aria-hidden />
                Add website
              </Button>
            }
          />
        </div>
      ) : (
        <div className="divide-y divide-border/70">
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

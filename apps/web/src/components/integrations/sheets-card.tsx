"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { isPickerConfigured, pickSpreadsheet } from "@/components/integrations/google-picker";
import type { SheetsPanelData } from "@/components/integrations/types";
import { CardTitle, ConfirmModal, Section, Spinner } from "@/components/rl";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";
import { cn } from "@/lib/utils";
import {
  attachPickedSheetAction,
  createSheetAction,
  detachSheetAction,
  disconnectSheetsAction,
  getPickerTokenAction,
  refreshSheetAction,
} from "@/server/actions/integration.actions";
import { selectProjectAction } from "@/server/actions/project.actions";

/**
 * Integrations → Google Sheets (DESIGN.md 2.7 Sheets), mapped onto the real integration:
 * one Google grant per account (connected through the OAuth start/callback routes) and one
 * spreadsheet per project, chosen in Google's Picker or created by Routely. Routely owns a tab
 * called "Routely" and rewrites it with the last 30 days whenever traffic arrives and on a daily
 * schedule — so there is no worksheet or sync-time choice to offer.
 */
export function SheetsCard({
  projectId,
  projectName,
  timezone,
  data,
}: {
  projectId: string;
  projectName: string;
  timezone: string;
  data: SheetsPanelData;
}) {
  const { connection, destination } = data;
  const [changing, setChanging] = useState(false);

  const grantBroken = !!connection && (connection.needsReconnect || !connection.canUseSheets);
  const on = !!connection && !!destination && !grantBroken && !changing;

  return (
    <Section padded className="gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle size={15.5}>Google Sheets sync</CardTitle>
          <p className="mt-1 max-w-[540px] text-[13px] text-ink-3">
            Routely keeps a spreadsheet up to date with the last 30 days of results per experiment
            and variant, ready for client reporting — refreshed within seconds of new visits and
            conversions, and once a day.
          </p>
        </div>
        {connection && !grantBroken ? (
          <span className="rounded-[20px] bg-[#E6F5EE] px-2.5 py-1 text-xs font-extrabold text-success-text">
            Connected
          </span>
        ) : null}
      </div>

      {!data.configured ? (
        <Dashed title="Google Sheets isn’t configured on this deployment">
          Set{" "}
          <code className="font-mono text-[12.5px] text-foreground">
            {data.configurationHint ?? "the Google OAuth variables"}
          </code>{" "}
          to enable it. Routely never stores a Google refresh token without an encryption key.
        </Dashed>
      ) : !connection ? (
        <Dashed
          title="Not connected"
          action={<ConnectButton projectId={projectId} label="Connect Google Sheets" />}
        >
          You’ll sign in with Google once. Routely can then see only the spreadsheets you pick and
          the ones it creates for you. Nothing else in your Drive is touched.
        </Dashed>
      ) : grantBroken ? (
        <ErrorBox
          title={
            connection.needsReconnect
              ? "Google access has stopped working"
              : "A required permission was declined"
          }
          action={<ConnectButton projectId={projectId} label="Reconnect" tone="danger" />}
        >
          {connection.needsReconnect
            ? `${connection.statusDetail ?? "Google refused Routely’s access."} Reconnect to resume syncing — every project keeps its spreadsheet.`
            : "Routely wasn’t allowed to create and edit the spreadsheets you choose. Reconnect and leave that permission ticked."}
        </ErrorBox>
      ) : !destination || changing ? (
        <PickDestination
          projectId={projectId}
          projectName={projectName}
          data={data}
          onCancel={destination ? () => setChanging(false) : undefined}
          onDone={() => setChanging(false)}
        />
      ) : null}

      {on && destination ? (
        <>
          {destination.lastError ? (
            <ErrorBox
              title="Last refresh failed"
              action={<ConnectButton projectId={projectId} label="Reconnect" tone="danger" />}
            >
              {destination.lastError}
            </ErrorBox>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
            <InfoTile label="Destination">
              {destination.spreadsheetName ?? destination.spreadsheetId} › {destination.sheetTitle}
            </InfoTile>
            <InfoTile label="Last sync">
              {destination.refreshedAt ? when(destination.refreshedAt, timezone) : "Not synced yet"}
            </InfoTile>
            <InfoTile label="Next sync">With the next visit or conversion · daily</InfoTile>
          </div>
        </>
      ) : null}

      {connection && !grantBroken && (on || !destination || changing) ? (
        <RowsTable
          title={on ? "Column mapping · latest rows" : "Preview of the rows Routely will write"}
          data={data}
        />
      ) : null}

      {on && destination ? (
        <ConnectedActions
          projectId={projectId}
          sheetTitle={destination.sheetTitle}
          onChange={() => setChanging(true)}
        />
      ) : connection ? (
        <DisconnectLink />
      ) : null}
    </Section>
  );
}

function when(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
}

function Dashed({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-lg border border-dashed border-[#CBD1DC] p-6">
      <div className="font-extrabold">{title}</div>
      <div className="text-[13px] text-ink-3">{children}</div>
      {action}
    </div>
  );
}

function ErrorBox({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#F3C9C0] bg-[#FCEDEA] px-4 py-3.5"
    >
      <div className="min-w-0 flex-[1_1_260px]">
        <div className="font-extrabold text-danger-text">{title}</div>
        <div className="mt-0.5 text-[13px] text-[#7A2E1D]">{children}</div>
      </div>
      {action}
    </div>
  );
}

function InfoTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-divider p-3">
      <div className="text-xs font-bold text-ink-3">{label}</div>
      <div className="mt-0.5 text-[13.5px] font-extrabold break-words">{children}</div>
    </div>
  );
}

/**
 * Starts the OAuth flow: a real POST form to the start route (it refuses GET by design). The
 * project is remembered first (`rl_project`) so the callback lands back on this project's page.
 */
function ConnectButton({
  projectId,
  label,
  tone = "dark",
}: {
  projectId: string;
  label: string;
  tone?: "dark" | "danger";
}) {
  const form = useRef<HTMLFormElement>(null);
  const [waiting, setWaiting] = useState(false);
  return (
    <form
      ref={form}
      action="/api/integrations/google/start"
      method="post"
      onSubmit={(e) => {
        if (waiting) return e.preventDefault();
        e.preventDefault();
        setWaiting(true);
        void selectProjectAction(projectId)
          .catch(() => null)
          .finally(() => form.current?.submit());
      }}
    >
      {waiting ? (
        <span role="status" className="flex h-[38px] items-center gap-3 font-bold">
          <Spinner size={20} />
          Waiting for Google authorization…
        </span>
      ) : (
        <Button
          type="submit"
          variant={tone === "dark" ? "dark" : "destructive-outline"}
          className={cn(
            "font-extrabold",
            tone === "danger" && "h-[34px] border-danger-text px-3 text-danger-text",
          )}
        >
          {label}
        </Button>
      )}
    </form>
  );
}

function asForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const IDLE: FormState = { status: "idle" };

function PickDestination({
  projectId,
  projectName,
  data,
  onCancel,
  onDone,
}: {
  projectId: string;
  projectName: string;
  data: SheetsPanelData;
  onCancel?: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"pick" | "create" | null>(null);
  const [, start] = useTransition();
  const picker = isPickerConfigured(data.pickerKey ?? undefined, data.projectNumber ?? undefined);

  function choose() {
    setBusy("pick");
    start(async () => {
      try {
        const token = await getPickerTokenAction();
        if (!token.ok) return void toast(token.message);
        const picked = await pickSpreadsheet({
          accessToken: token.accessToken,
          developerKey: data.pickerKey!,
          appId: data.projectNumber!,
        }).catch((error: unknown) => {
          toast(
            error instanceof Error
              ? `${error.message} You can still create a new spreadsheet instead.`
              : "Google’s file picker couldn’t be opened.",
          );
          return null;
        });
        if (!picked) return;
        const result = await attachPickedSheetAction({
          websiteId: projectId,
          spreadsheetId: picked.spreadsheetId,
        });
        if (!result.ok) return void toast(result.message);
        toast(
          `Google Sheets connected · writing to “${result.sheetTitle}” in ${result.spreadsheetName}`,
        );
        onDone();
        router.refresh();
      } finally {
        setBusy(null);
      }
    });
  }

  function create() {
    setBusy("create");
    start(async () => {
      const result = await createSheetAction(IDLE, asForm({ websiteId: projectId }));
      setBusy(null);
      toast(
        result.message ??
          (result.status === "error" ? "Couldn’t create the spreadsheet." : "Spreadsheet created"),
      );
      if (result.status === "success") {
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[13px] font-extrabold">Spreadsheet for {projectName}</div>
        <p className="mt-0.5 text-[13px] text-ink-3">
          Routely adds a tab called “Routely” and keeps it up to date. Nothing else in the
          spreadsheet is touched.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {picker ? (
          <Button
            variant="outline"
            className="border-brand text-brand hover:text-brand"
            onClick={choose}
            disabled={busy !== null}
          >
            {busy === "pick" ? <Spinner size={13} /> : null}
            Choose an existing spreadsheet
          </Button>
        ) : null}
        <Button variant={picker ? "outline" : "default"} onClick={create} disabled={busy !== null}>
          {busy === "create" ? <Spinner size={13} onBlue={!picker} /> : null}
          {busy === "create" ? "Creating…" : "+ Create a new spreadsheet"}
        </Button>
        {onCancel ? (
          <Button variant="outline" onClick={onCancel} disabled={busy !== null}>
            Cancel
          </Button>
        ) : null}
      </div>
      {!picker ? (
        <p className="text-[12.5px] text-ink-3">
          Choosing an existing spreadsheet needs{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_GOOGLE_API_KEY</code> and{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER</code>. Creating a
          new one works without them.
        </p>
      ) : null}
    </div>
  );
}

function RowsTable({ title, data }: { title: string; data: SheetsPanelData }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] font-extrabold">{title}</div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
          <thead className="bg-[#F5F6F9]">
            <tr>
              {data.columns.map((c) => (
                <th
                  key={c}
                  className="px-3 py-2 text-left font-mono text-[11.5px] font-extrabold whitespace-nowrap text-ink-2"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.rows.length === 0 ? (
              <tr className="border-t border-divider">
                <td colSpan={data.columns.length} className="px-3 py-3 text-ink-3">
                  No visitors assigned in the last 30 days yet — rows appear once an experiment has
                  traffic.
                </td>
              </tr>
            ) : (
              data.rows.map((row, i) => (
                <tr key={i} className="border-t border-divider">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={cn(
                        "px-3 py-2 whitespace-nowrap",
                        j === 1 && "max-w-[260px] truncate",
                      )}
                    >
                      {cell === "" ? "—" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConnectedActions({
  projectId,
  sheetTitle,
  onChange,
}: {
  projectId: string;
  sheetTitle: string;
  onChange: () => void;
}) {
  const router = useRouter();
  const [syncing, startSync] = useTransition();
  const [stopping, startStop] = useTransition();
  const [confirmStop, setConfirmStop] = useState(false);

  function syncNow() {
    startSync(async () => {
      const result = await refreshSheetAction(IDLE, asForm({ websiteId: projectId }));
      const rows = result.message?.match(/(\d+) rows?/)?.[1];
      toast(
        result.status === "success" && rows
          ? `Synced ${rows} ${rows === "1" ? "row" : "rows"} to “${sheetTitle}”`
          : (result.message ?? "The sync failed."),
      );
      router.refresh();
    });
  }

  function stop() {
    startStop(async () => {
      const result = await detachSheetAction(IDLE, asForm({ websiteId: projectId }));
      setConfirmStop(false);
      toast(result.message ?? "Stopped syncing.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        className="border-brand font-extrabold text-brand hover:text-brand"
        onClick={syncNow}
        disabled={syncing}
      >
        {syncing ? "Syncing…" : "Sync now"}
      </Button>
      <Button variant="outline" onClick={onChange}>
        Change spreadsheet
      </Button>
      <Button variant="outline" onClick={() => setConfirmStop(true)}>
        Stop syncing this project
      </Button>
      <DisconnectButton />
      <ConfirmModal
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Stop syncing this project?"
        body="Routely stops updating this project’s spreadsheet. The spreadsheet and the rows already in it stay where they are."
        confirmLabel={stopping ? "Stopping…" : "Stop syncing"}
        tone="dark"
        onConfirm={stop}
        pending={stopping}
      />
    </div>
  );
}

function DisconnectLink() {
  return (
    <div className="flex flex-wrap gap-2">
      <DisconnectButton />
    </div>
  );
}

/** Disconnect is account-wide — the grant is per account — and the modal says so. */
function DisconnectButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirm() {
    start(async () => {
      const result = await disconnectSheetsAction(IDLE, new FormData());
      setOpen(false);
      toast(
        result.status === "success"
          ? "Google Sheets disconnected"
          : (result.message ?? "Couldn’t disconnect."),
      );
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        className="border-[#F3C9C0] text-danger-text hover:text-danger-text"
        onClick={() => setOpen(true)}
      >
        Disconnect
      </Button>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Disconnect Google Sheets?"
        body="Syncs stop for every project in your account. Rows already written to your spreadsheets stay where they are."
        confirmLabel={pending ? "Disconnecting…" : "Disconnect"}
        onConfirm={confirm}
        pending={pending}
      />
    </>
  );
}

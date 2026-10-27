"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";

import { pickSpreadsheet } from "@/components/integrations/google-picker";
import { PlusIcon, Spinner, XIcon } from "@/components/rt/icons";
import { Modal } from "@/components/rt/modal";
import { ACCENT, ACCENT_TINT, btn } from "@/components/rt/styles";
import { relativeTime } from "@/lib/experiment-time";
import { IDLE } from "@/lib/form-state";
import { DRIVE_SHEETS, GS_EMAIL, type GsState } from "@/lib/mock/project-dashboard";
import {
  GOOGLE_CONNECT_ACTION,
  type ProjectSheetsCard,
  SHEETS_COPY,
  defaultSpreadsheetName,
  lastErrorCopy,
} from "@/lib/sheets-card";
import { cn } from "@/lib/utils";
import {
  attachPickedSheetAction,
  createSheetAction,
  detachSheetAction,
  getPickerTokenAction,
  refreshSheetAction,
} from "@/server/actions/integration.actions";
import { SPREADSHEET_NAME_MAX } from "@/validation/integration";

/** The setup dialog's own state; it lives in the page so its timers survive the dialog closing. */
export interface SheetsPanel {
  open: boolean;
  mode: "pick" | "create" | null;
  sel: string | null;
  name: string | null;
  createTried: boolean;
  busy: boolean;
  syncing: boolean;
  confirm: boolean;
}

export const CLOSED_PANEL: SheetsPanel = {
  open: false,
  mode: null,
  sel: null,
  name: null,
  createTried: false,
  busy: false,
  syncing: false,
  confirm: false,
};

export interface SheetsHandlers {
  close(): void;
  connect(): void;
  patch(p: Partial<SheetsPanel>): void;
  disconnect(): void;
  change(): void;
  usePicked(): void;
  create(): void;
  syncNow(): void;
  openSheet(): void;
  /** Real data only: open the Google Picker instead of the design's in-dialog list. */
  openPicker?(): void;
}

/**
 * Real-data overrides for the presentational dialog. Absent, the dialog renders the design's mock
 * copy (the project dashboard view still drives it that way until WP5 wires it); present, it shows
 * the workspace's Google account, the project's spreadsheet and only the controls the viewer's
 * role allows.
 */
export interface LiveSheets {
  websiteId: string;
  email: string;
  initials: string;
  sheetTitle: string;
  /** "2 min ago", or null before the first successful write. */
  lastSync: string | null;
  lastError: string | null;
  /** A state the design has no screen for. */
  problem: null | "not_configured" | "needs_reconnect";
  canManage: boolean;
  canSync: boolean;
  /** Manage *and* the member who connected Google — the Picker browses their Drive. */
  canPick: boolean;
  pickerAvailable: boolean;
  /** The spreadsheet a "Change" would replace, for the design's note. */
  replacing: string | null;
  /** Server-side failure of the create form. */
  createError: string | null;
  /** Opened on the Dashboard: Google's consent flow returns there (`from=dashboard`). */
  fromDashboard?: boolean;
}

const box =
  "flex min-w-0 items-center gap-3 rounded-xl border border-[#EEF0F3] bg-white px-4 py-3.5";
const actions =
  "flex flex-wrap justify-end gap-2 max-[641px]:w-full max-[641px]:[&>button]:h-11 max-[641px]:[&>button]:flex-auto";
const secondary = cn(btn.secondary, "px-3");
const primary = cn(btn.primary, "px-3.5 shadow-none");

function SheetIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M4 9h16" />
      <path d="M4 15h16" />
      <path d="M10 9v12" />
    </svg>
  );
}

export function MailIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size === 15 ? 2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="flex-none"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function Tile({
  bg,
  fg,
  size = 40,
  children,
}: {
  bg: string;
  fg: string;
  size?: number;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex flex-none items-center justify-center rounded-lg"
      style={{ width: size, height: size, background: bg, color: fg }}
    >
      {children}
    </span>
  );
}

function ConnectedPill() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-[#DCFCE7] px-2 text-xs font-semibold whitespace-nowrap text-[#166534]">
      <span aria-hidden className="size-1.5 rounded-full bg-[#16A34A]" />
      Connected
    </span>
  );
}

function StoppedPill() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-[#FEF2F2] px-2 text-xs font-semibold whitespace-nowrap text-[#B91C1C]">
      <span aria-hidden className="size-1.5 rounded-full bg-[#DC2626]" />
      Sync stopped
    </span>
  );
}

/**
 * "Connect email" as a real `<form method="post">` to the OAuth start route, carrying the project
 * so the grant lands on its workspace and the callback returns to its dashboard. Works without
 * JavaScript; `onSubmit` only flips the button into its waiting state.
 */
export function ConnectForm({
  websiteId,
  fromDashboard = false,
  disabled = false,
  busy = false,
  onSubmit,
  className,
  children,
}: {
  websiteId: string;
  /** Carried through Google so the project page can send the reader back to the Dashboard. */
  fromDashboard?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onSubmit?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      action={GOOGLE_CONNECT_ACTION}
      method="post"
      className="flex flex-none"
      onSubmit={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onSubmit?.();
      }}
    >
      <input type="hidden" name="websiteId" value={websiteId} />
      {fromDashboard ? <input type="hidden" name="from" value="dashboard" /> : null}
      <button type="submit" disabled={disabled} aria-busy={busy} className={className}>
        {children}
      </button>
    </form>
  );
}

/** The design's two name errors, checked before the server repeats them. */
function spreadsheetNameError(name: string): string | null {
  if (!name.trim()) return "Give the spreadsheet a name.";
  if (name.trim().length > SPREADSHEET_NAME_MAX) {
    return `Use ${SPREADSHEET_NAME_MAX} characters or fewer.`;
  }
  return null;
}

export function SheetsDialog({
  projectName,
  gs,
  panel,
  on,
  live,
}: {
  projectName: string;
  gs: GsState;
  panel: SheetsPanel;
  on: SheetsHandlers;
  live?: LiveSheets;
}) {
  const conn = gs.status === "connected";
  const waiting = gs.status === "waiting";
  const mode = panel.mode;
  const sheet = gs.sheet;
  const name = panel.name ?? defaultSpreadsheetName(projectName);
  const nameErr = panel.createTried ? (spreadsheetNameError(name) ?? live?.createError ?? "") : "";
  const email = live?.email ?? GS_EMAIL;
  const canManage = live?.canManage ?? true;
  const reconnect = live?.problem === "needs_reconnect";
  const notConfigured = live?.problem === "not_configured";
  const showLinking = conn && !!sheet && gs.link === "linking" && !mode;
  const showLinked = conn && !!sheet && gs.link === "linked" && !mode;

  return (
    <Modal
      open={panel.open}
      onOpenChange={(o) => {
        if (!o) on.close();
      }}
      title={null}
      busy={panel.busy}
      width={620}
      className="overflow-hidden"
    >
      <div className="flex items-start gap-3.5 border-b border-[#EEF0F3] px-6 pt-5 pb-4 max-[641px]:px-4">
        <Tile bg="#DCFCE7" fg="#166534">
          <SheetIcon size={20} />
        </Tile>
        <div className="flex min-w-0 flex-auto flex-col gap-0.5">
          <DialogPrimitive.Title className="m-0 text-base leading-6 font-semibold text-[#111827]">
            Google Sheets setup
          </DialogPrimitive.Title>
          <p className="m-0 text-sm leading-5 text-pretty text-[#4B5563]">
            Send {projectName}’s experiment results to a spreadsheet your team reports from.
          </p>
        </div>
        <button type="button" aria-label="Close" onClick={on.close} className={btn.icon}>
          <XIcon />
        </button>
      </div>

      <div
        aria-live="polite"
        className="flex flex-auto flex-col gap-[22px] overflow-y-auto px-6 py-5 max-[641px]:px-4"
      >
        <section aria-labelledby="rt-gs-acct" className="flex flex-col gap-2.5">
          <h3 id="rt-gs-acct" className="m-0 text-sm leading-5 font-semibold text-[#111827]">
            Connected account
          </h3>
          {conn ? (
            <>
              <div className={cn(box, "flex-wrap")}>
                <span
                  aria-hidden
                  className="inline-flex size-9 flex-none items-center justify-center rounded-full bg-[#DBEAFE] text-[13px] font-semibold text-[#1E40AF]"
                >
                  {live?.initials ?? "AM"}
                </span>
                <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
                  <span className="truncate text-sm leading-5 font-semibold text-[#111827]">
                    {email}
                  </span>
                  <span
                    className="text-[13px] leading-[18px] text-pretty"
                    style={{ color: reconnect ? "#B91C1C" : "#6B7280" }}
                  >
                    {reconnect
                      ? SHEETS_COPY.needsReconnect
                      : "Google account · can create and edit spreadsheets you pick"}
                  </span>
                </div>
                {reconnect ? <StoppedPill /> : <ConnectedPill />}
                {reconnect && live ? (
                  <ConnectForm
                    websiteId={live.websiteId}
                    fromDashboard={live.fromDashboard}
                    disabled={!canManage}
                    onSubmit={on.connect}
                    className={cn(primary, "min-w-[132px] gap-1.5")}
                  >
                    <MailIcon />
                    Connect email
                  </ConnectForm>
                ) : null}
                {!live || (live.canManage && sheet && !reconnect) ? (
                  <button
                    type="button"
                    onClick={() => on.patch({ confirm: true })}
                    className="h-8 cursor-pointer border-0 bg-transparent px-1 text-[13px] font-medium whitespace-nowrap text-[#B91C1C] outline-none hover:text-[#111827] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>
              {panel.confirm ? (
                <div
                  role="alert"
                  className="flex flex-col gap-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm leading-5 font-semibold text-[#B91C1C]">
                      Disconnect Google Sheets?
                    </span>
                    <span className="text-[13px] leading-[19px] text-pretty text-[#B91C1C]">
                      Routely stops updating the spreadsheet for {projectName}. Anything already in
                      the spreadsheet stays there, and you can reconnect at any time.
                    </span>
                  </div>
                  <div className={actions}>
                    <button
                      type="button"
                      onClick={() => on.patch({ confirm: false })}
                      className={secondary}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={on.disconnect}
                      disabled={panel.busy}
                      aria-busy={panel.busy}
                      className={cn(btn.danger, "px-3.5 hover:enabled:brightness-[.8]")}
                    >
                      {panel.busy ? <Spinner /> : null}
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className={cn(box, "flex-wrap")}>
              <Tile bg="#F3F4F6" fg="#4B5563">
                <MailIcon size={18} />
              </Tile>
              <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
                <span className="text-sm leading-5 font-semibold text-[#111827]">
                  {notConfigured ? SHEETS_COPY.notConfigured : "No email connected"}
                </span>
                <span
                  className="text-[13px] leading-[18px] text-pretty"
                  style={{ color: gs.status === "error" ? "#B91C1C" : "#6B7280" }}
                >
                  {notConfigured
                    ? SHEETS_COPY.notConfiguredDetail
                    : waiting
                      ? "Finish signing in in the Google window…"
                      : gs.status === "error"
                        ? (live?.createError ?? "Google sign-in didn’t finish. Try again.")
                        : live && !canManage
                          ? `${SHEETS_COPY.adminOnly} Ask one to connect a Google account.`
                          : "Connect the Google account Routely should use for this project’s spreadsheet."}
                </span>
              </div>
              {live ? (
                <ConnectForm
                  websiteId={live.websiteId}
                  fromDashboard={live.fromDashboard}
                  disabled={waiting || notConfigured || !canManage}
                  busy={waiting}
                  onSubmit={on.connect}
                  className={cn(primary, "min-w-[132px] gap-1.5")}
                >
                  {waiting ? <Spinner /> : <MailIcon />}
                  {waiting ? "Connecting…" : "Connect email"}
                </ConnectForm>
              ) : (
                <button
                  type="button"
                  onClick={on.connect}
                  disabled={waiting}
                  aria-busy={waiting}
                  className={cn(primary, "min-w-[132px] gap-1.5")}
                >
                  {waiting ? <Spinner /> : <MailIcon />}
                  {waiting ? "Connecting…" : "Connect email"}
                </button>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="rt-gs-sheet" className="flex flex-col gap-2.5">
          <h3 id="rt-gs-sheet" className="m-0 text-sm leading-5 font-semibold text-[#111827]">
            Spreadsheet
          </h3>

          {!conn ? (
            <div className={cn(box, "bg-[#FAFBFC] text-[#6B7280]")}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="flex-[0_0_18px]"
              >
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              <span className="text-sm leading-5 text-pretty">
                Connect your email first. Then you can pick an existing spreadsheet or create a new
                Google Sheet.
              </span>
            </div>
          ) : null}

          {conn && !sheet && !mode ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-3">
              <ChoiceCard
                disabled={!!live && (!live.canPick || !live.pickerAvailable || reconnect)}
                onClick={() =>
                  live && on.openPicker ? on.openPicker() : on.patch({ mode: "pick", sel: null })
                }
                tile={
                  <Tile bg="#F3F4F6" fg="#374151">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    </svg>
                  </Tile>
                }
                title="Choose an existing spreadsheet"
                body={
                  live && live.canManage && !live.canPick
                    ? SHEETS_COPY.onlyConnectorCanPick(email)
                    : live && !live.pickerAvailable
                      ? "Google’s file picker isn’t set up here. Create a new Google Sheet instead."
                      : `Pick one from ${email}’s Google Drive.`
                }
              />
              <ChoiceCard
                disabled={!!live && (!live.canManage || reconnect)}
                onClick={() =>
                  on.patch({
                    mode: "create",
                    name: defaultSpreadsheetName(projectName),
                    createTried: false,
                  })
                }
                tile={
                  <Tile bg="#DCFCE7" fg="#166534">
                    <PlusIcon size={18} />
                  </Tile>
                }
                title="Create a new Google Sheet"
                body="Routely creates it and adds a “Routely” tab."
              />
              {live?.replacing ? (
                <p className="[grid-column:1/-1] m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">
                  “{live.replacing}” stops updating once you pick a new spreadsheet. Its Routely tab
                  stays as it is.
                </p>
              ) : null}
              {live && !live.canManage ? (
                <p className="[grid-column:1/-1] m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">
                  {SHEETS_COPY.adminOnly}
                </p>
              ) : null}
            </div>
          ) : null}

          {conn && mode === "pick" ? (
            <div className="flex flex-col gap-3">
              <div
                role="radiogroup"
                aria-label="Spreadsheets in Google Drive"
                className="flex flex-col overflow-hidden rounded-xl border border-[#EEF0F3]"
              >
                {DRIVE_SHEETS.map((x, i) => {
                  const on1 = panel.sel === x.id;
                  return (
                    <button
                      key={x.id}
                      type="button"
                      role="radio"
                      aria-checked={on1}
                      onClick={() => on.patch({ sel: x.id })}
                      className="flex w-full cursor-pointer items-center gap-3 border-0 border-t px-3.5 py-3 text-left text-[#111827] outline-none hover:!bg-[#F9FAFB] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0091FF]"
                      style={{
                        borderTopColor: i === 0 ? "transparent" : "#EEF0F3",
                        background: on1 ? ACCENT_TINT : "#FFFFFF",
                      }}
                    >
                      <span
                        aria-hidden
                        className="size-[18px] flex-[0_0_18px] rounded-full bg-white"
                        style={{ border: on1 ? `5px solid ${ACCENT}` : "1.5px solid #C2C8D0" }}
                      />
                      <Tile bg="#DCFCE7" fg="#166534" size={30}>
                        <SheetIcon size={16} />
                      </Tile>
                      <span className="flex min-w-0 flex-col gap-px">
                        <span className="truncate text-sm leading-[19px] font-semibold">
                          {x.name}
                        </span>
                        <span className="text-[13px] leading-[17px] text-[#6B7280]">{x.meta}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className={actions}>
                <button
                  type="button"
                  onClick={() => on.patch({ mode: null })}
                  className={secondary}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={on.usePicked}
                  disabled={!panel.sel}
                  className={primary}
                >
                  Use this spreadsheet
                </button>
              </div>
            </div>
          ) : null}

          {conn && mode === "create" ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="rt-gs-name" className="text-[13px] font-medium text-[#374151]">
                  Spreadsheet name
                </label>
                <input
                  id="rt-gs-name"
                  type="text"
                  value={name}
                  onChange={(e) => on.patch({ name: e.target.value })}
                  disabled={panel.busy}
                  maxLength={SPREADSHEET_NAME_MAX}
                  aria-invalid={!!nameErr}
                  aria-describedby="rt-gs-name-help"
                  className="h-10 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] disabled:opacity-60 aria-[invalid=true]:border-[#DC2626]"
                />
                {nameErr ? (
                  <p
                    id="rt-gs-name-help"
                    role="alert"
                    className="m-0 text-[13px] leading-[19px] text-[#B91C1C]"
                  >
                    {nameErr}
                  </p>
                ) : (
                  <p id="rt-gs-name-help" className="m-0 text-[13px] leading-[19px] text-[#6B7280]">
                    Routely creates it in {email}’s Google Drive and adds a tab called “Routely”.
                  </p>
                )}
              </div>
              <div className={actions}>
                <button
                  type="button"
                  onClick={() => on.patch({ mode: null })}
                  disabled={panel.busy}
                  className={secondary}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={on.create}
                  disabled={panel.busy}
                  aria-busy={panel.busy}
                  className={cn(primary, "gap-1.5")}
                >
                  {panel.busy ? <Spinner /> : null}
                  {panel.busy ? "Creating…" : "Create Google Sheet"}
                </button>
              </div>
            </div>
          ) : null}

          {showLinking && sheet ? (
            <div className={box}>
              <span className="inline-flex flex-[0_0_15px]" style={{ color: ACCENT }}>
                <Spinner />
              </span>
              <span className="text-sm leading-5 text-pretty text-[#374151]">
                Setting up sync with “{sheet.name}”…
              </span>
            </div>
          ) : null}

          {showLinked && sheet ? (
            <div className={cn(box, "flex-wrap")}>
              <Tile bg="#DCFCE7" fg="#166534">
                <SheetIcon />
              </Tile>
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                <span className="text-sm leading-5 font-semibold [overflow-wrap:anywhere] text-[#111827]">
                  {sheet.name}
                </span>
                <span className="text-[13px] leading-[18px] [overflow-wrap:anywhere] text-[#6B7280]">
                  Tab “{live?.sheetTitle ?? "Routely"}” · in {email}’s Google Drive
                </span>
              </div>
              <div className="flex flex-wrap gap-2 max-[641px]:w-full max-[641px]:[&>button]:h-11 max-[641px]:[&>button]:flex-auto">
                <button type="button" onClick={on.openSheet} className={cn(secondary, "gap-1.5")}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M14 4h6v6" />
                    <path d="M20 4 10 14" />
                    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                  </svg>
                  Open in Google Sheets
                </button>
                {canManage ? (
                  <button type="button" onClick={on.change} className={secondary}>
                    Change
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {showLinked ? (
          <section aria-labelledby="rt-gs-sync" className="flex flex-col gap-2.5">
            <h3 id="rt-gs-sync" className="m-0 text-sm leading-5 font-semibold text-[#111827]">
              Sync
            </h3>
            <div className={cn(box, "flex-wrap")}>
              <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
                <span className="inline-flex items-center gap-2 text-sm leading-5 font-semibold text-[#111827]">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 rounded-full",
                      live?.lastError || reconnect ? "bg-[#DC2626]" : "bg-[#16A34A]",
                    )}
                  />
                  {live?.lastError || reconnect
                    ? "Sync stopped"
                    : live && !live.lastSync
                      ? "Waiting for the first sync"
                      : `Up to date · last synced ${live?.lastSync ?? gs.lastSync}`}
                </span>
                <span
                  className="text-[13px] leading-[18px] text-pretty"
                  style={{ color: live?.lastError || reconnect ? "#B91C1C" : "#6B7280" }}
                >
                  {reconnect
                    ? SHEETS_COPY.needsReconnect
                    : live?.lastError
                      ? lastErrorCopy(live.lastError)
                      : SHEETS_COPY.refreshSchedule}
                </span>
              </div>
              {!live || (live.canSync && !reconnect) ? (
                <button
                  type="button"
                  onClick={on.syncNow}
                  disabled={panel.syncing}
                  aria-busy={panel.syncing}
                  className={cn(secondary, "gap-1.5")}
                >
                  {panel.syncing ? (
                    <Spinner />
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
                      <path d="M20 3.5v5h-5" />
                    </svg>
                  )}
                  {live?.lastError
                    ? panel.syncing
                      ? "Trying again…"
                      : "Try again"
                    : panel.syncing
                      ? "Syncing…"
                      : "Sync now"}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 border-t border-[#EEF0F3] px-6 py-3.5 max-[641px]:px-4">
        <button type="button" onClick={on.close} className={cn(primary, "min-w-[88px] gap-1.5")}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function ChoiceCard({
  onClick,
  tile,
  title,
  body,
  disabled = false,
}: {
  onClick(): void;
  tile: ReactNode;
  title: string;
  body: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E5E7EB] bg-white p-4 text-left text-[#111827] outline-none hover:bg-[#F9FAFB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-white"
    >
      {tile}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm leading-5 font-semibold">{title}</span>
        <span className="text-[13px] leading-[18px] text-pretty text-[#6B7280]">{body}</span>
      </span>
    </button>
  );
}

/**
 * The project dashboard's Google Sheets dialog, wired to the real actions.
 *
 * Owns its own transient state (which panel, busy flags, the optimistic "linking" moment) and
 * renders `SheetsDialog` with `live` data from `card` — `getProjectSheetsCard` on the server.
 * After every change it calls `router.refresh()`, so the next `card` comes from the database.
 *
 *   <ProjectSheetsDialog card={card} open={open} onClose={() => setOpen(false)} notify={notify} />
 *
 * "Disconnect" here detaches *this project's* spreadsheet only; revoking Google for the whole
 * workspace is on the Integrations page.
 */
export function ProjectSheetsDialog({
  card,
  open,
  onClose,
  notify,
  initialPanel,
  fromDashboard = false,
}: {
  card: ProjectSheetsCard;
  open: boolean;
  onClose(): void;
  notify(title: string, note: string): void;
  /** Optional starting panel, e.g. from a `?view=` state. */
  initialPanel?: Partial<SheetsPanel>;
  /** Opened on the Dashboard (the checklist): Connect email returns there, not to the project. */
  fromDashboard?: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<SheetsPanel>({ ...CLOSED_PANEL, ...initialPanel });
  const [waiting, setWaiting] = useState(false);
  /** Set while a pick/create is being attached, until the refreshed card arrives. */
  const [linking, setLinking] = useState<{ id: string; name: string } | null>(null);
  /** "Change" pressed: show the choice again, remembering what will be replaced. */
  const [replacing, setReplacing] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const projectName = card.projectName;
  const destination = card.destination;
  const account = card.account;
  const email = account?.email ?? "your Google account";
  const websiteId = card.websiteId;

  // A refreshed card ends the optimistic states it was standing in for. Adjusted during render
  // (React's "storing information from previous renders" pattern), not in an effect.
  const cardKey = `${destination?.spreadsheetId ?? ""}|${destination?.refreshedAt ?? ""}`;
  const [seenKey, setSeenKey] = useState(cardKey);
  if (seenKey !== cardKey) {
    setSeenKey(cardKey);
    setLinking(null);
    setReplacing(null);
  }

  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setWaiting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const patch = (p: Partial<SheetsPanel>) => setPanel((cur) => ({ ...cur, ...p }));
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  const shownSheet = linking
    ? linking
    : destination && replacing === null
      ? {
          id: destination.spreadsheetId,
          name: destination.spreadsheetName ?? "Untitled spreadsheet",
        }
      : null;

  const gs: GsState = {
    status: account
      ? "connected"
      : waiting
        ? "waiting"
        : card.outcome?.kind === "error"
          ? "error"
          : "none",
    sheet: shownSheet,
    link: linking ? "linking" : shownSheet ? "linked" : "none",
    lastSync: "",
  };

  const live: LiveSheets = {
    websiteId,
    fromDashboard,
    email,
    initials: account?.initials ?? "G",
    sheetTitle: destination?.sheetTitle ?? "Routely",
    lastSync: destination?.refreshedAt
      ? relativeTime(new Date(destination.refreshedAt), new Date())
      : null,
    lastError: destination?.lastError ?? null,
    problem: !card.configured
      ? "not_configured"
      : account && (account.status === "NEEDS_RECONNECT" || !account.canUseSheets)
        ? "needs_reconnect"
        : null,
    canManage: card.permissions.manage,
    canSync: card.permissions.sync,
    canPick: card.permissions.pick,
    pickerAvailable: card.picker !== null,
    replacing,
    createError: account
      ? createError
      : card.outcome?.kind === "error"
        ? card.outcome.message
        : null,
  };

  async function attachPicked() {
    if (!card.picker) return;
    const token = await getPickerTokenAction({ websiteId });
    if (!token.ok) {
      notify("Couldn’t open Google Drive", token.message);
      return;
    }

    let picked;
    try {
      picked = await pickSpreadsheet({
        accessToken: token.accessToken,
        developerKey: card.picker.apiKey,
        appId: card.picker.projectNumber,
        title: `Choose a spreadsheet for ${projectName}`,
      });
    } catch (error) {
      notify(
        "Couldn’t open Google Drive",
        error instanceof Error
          ? `${error.message} You can still create a new Google Sheet instead.`
          : "Google’s file picker could not be opened.",
      );
      return;
    }
    if (!picked) return;

    const name = picked.name ?? "your spreadsheet";
    setLinking({ id: picked.spreadsheetId, name });
    const result = await attachPickedSheetAction({
      websiteId,
      spreadsheetId: picked.spreadsheetId,
    });
    if (!result.ok) {
      setLinking(null);
      notify("Couldn’t connect that spreadsheet", result.message);
      return;
    }
    notify(
      "Spreadsheet connected",
      `Routely added a “${result.sheetTitle}” tab to “${result.spreadsheetName}” and filled it with ${projectName}’s results.`,
    );
    router.refresh();
  }

  const on: SheetsHandlers = {
    close() {
      if (panel.busy) return;
      setPanel(CLOSED_PANEL);
      setReplacing(null);
      setCreateError(null);
      onClose();
    },
    connect() {
      setWaiting(true);
    },
    patch(p) {
      if (p.name !== undefined || p.mode !== undefined) setCreateError(null);
      patch(p);
    },
    async disconnect() {
      if (panel.busy) return;
      patch({ busy: true });
      const result = await detachSheetAction(IDLE, form({ websiteId }));
      patch({ busy: false, confirm: false, mode: null });
      if (result.status !== "success") {
        notify("Couldn’t disconnect Google Sheets", result.message ?? "Please try again.");
        return;
      }
      notify(
        "Google Sheets disconnected",
        `Routely stopped updating the spreadsheet for ${projectName}. Its data stays where it is.`,
      );
      router.refresh();
    },
    change() {
      patch({ mode: null, confirm: false });
      setReplacing(destination?.spreadsheetName ?? "The current spreadsheet");
    },
    usePicked() {
      void attachPicked();
    },
    openPicker() {
      void attachPicked();
    },
    async create() {
      if (panel.busy) return;
      const name = (panel.name ?? defaultSpreadsheetName(projectName)).trim();
      if (spreadsheetNameError(name)) {
        patch({ createTried: true });
        return;
      }
      setCreateError(null);
      patch({ createTried: true, busy: true, name });
      const result = await createSheetAction(IDLE, form({ websiteId, name }));
      if (result.status !== "success") {
        setCreateError(
          result.fieldErrors?.name?.[0] ??
            result.message ??
            "Couldn’t create the spreadsheet. Try again.",
        );
        patch({ busy: false });
        return;
      }
      setLinking({ id: "new", name });
      patch({ busy: false, mode: null, createTried: false });
      notify(
        "Google Sheet created",
        `“${name}” is ready in ${email}’s Google Drive with a “Routely” tab.`,
      );
      router.refresh();
    },
    async syncNow() {
      if (panel.syncing) return;
      const recovering = Boolean(destination?.lastError);
      patch({ syncing: true });
      const result = await refreshSheetAction(IDLE, form({ websiteId }));
      patch({ syncing: false });
      if (result.status !== "success") {
        notify("Sync didn’t finish", result.message ?? "Please try again in a moment.");
        router.refresh();
        return;
      }
      if (recovering) {
        notify(
          "Sync is working again",
          "Routely caught up on results since the last successful sync.",
        );
      } else {
        notify("Sync complete", "The Routely tab is up to date.");
      }
      router.refresh();
    },
    openSheet() {
      if (destination) window.open(destination.url, "_blank", "noopener,noreferrer");
    },
  };

  return (
    <SheetsDialog
      projectName={projectName}
      gs={gs}
      panel={{ ...panel, open }}
      on={on}
      live={live}
    />
  );
}

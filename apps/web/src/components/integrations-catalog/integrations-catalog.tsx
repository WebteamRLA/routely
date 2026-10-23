"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { Spinner, Svg } from "@/components/rt/icons";
import { Modal } from "@/components/rt/modal";
import { ToastHost, useToast } from "@/components/rt/toast";
import { btn, focusRing, pageDescription, pageTitle } from "@/components/rt/styles";
import { IDLE } from "@/lib/form-state";
import { REPORTING_GROUP, type IntegrationsViewName } from "@/lib/mock/integrations";
import {
  GOOGLE_CONNECT_ACTION,
  type IntegrationsSheetsCard,
  SHEETS_COPY,
  lastErrorCopy,
  sheetsStatus,
} from "@/lib/sheets-card";
import { cn } from "@/lib/utils";
import { disconnectSheetsAction } from "@/server/actions/integration.actions";

/**
 * The design's Integrations catalog: one "Reporting" group holding the Google Sheets card, which
 * either shows the workspace's connected Google account or offers to connect one.
 *
 * "Connect email" is a real `<form method="post">` to the OAuth start route (it works without
 * JavaScript; the script only adds the "Connecting…" state while the browser leaves for Google).
 * The callback returns here with `?sheets=…`, read on the server into `card.outcome`.
 *
 * Beyond the design: "Sync stopped" also covers a grant Google revoked ("Google needs you to
 * reconnect"), the card is disabled when the integration is not configured, and Owners/Admins get
 * a workspace-level "Disconnect" that revokes Google for every project. A project dashboard's own
 * Disconnect only detaches that project's spreadsheet.
 *
 * `?view=catalogConnecting` still opens the purely visual waiting state.
 */
export function IntegrationsCatalog({
  card,
  view,
}: {
  card: IntegrationsSheetsCard;
  view: IntegrationsViewName;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast, notify } = useToast();
  const [waiting, setWaiting] = useState(view === "catalogConnecting");
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, startDisconnect] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  const status = sheetsStatus({
    configured: card.configured,
    account: card.account,
    failing: card.failing.length > 0,
  });
  const connected = card.account !== null && status !== "not_configured";
  const stopped = status === "needs_reconnect" || status === "sync_stopped";
  const outcomeError =
    card.outcome?.kind !== "error"
      ? null
      : card.outcome.message === SHEETS_COPY.signInFailed
        ? SHEETS_COPY.catalogSignInFailed
        : card.outcome.message;
  const email = card.account?.email ?? "Google account";
  const canConnect = card.configured && card.permissions.manage;
  const showConnect = !connected || status === "needs_reconnect";

  // The callback's outcome is shown once, then dropped from the URL so a reload does not repeat it.
  useEffect(() => {
    if (!card.outcome) return;
    if (card.outcome.kind === "connected" && card.account) {
      notify(
        "Google Sheets connected",
        `${card.account.email ?? "Your Google account"} is now connected to ${card.workspaceName}.`,
      );
    }
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per outcome
  }, [card.outcome]);

  // Back from Google's screen restores this page from the bfcache with the spinner still on.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setWaiting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  function confirmDisconnect() {
    startDisconnect(async () => {
      const result = await disconnectSheetsAction(IDLE, new FormData());
      if (result.status !== "success") {
        setFailure(result.message ?? "Could not disconnect Google. Try again.");
        return;
      }
      setConfirming(false);
      setFailure(null);
      notify(
        "Google Sheets disconnected",
        "Routely stopped updating every project’s spreadsheet. Their data stays where it is.",
      );
      router.refresh();
    });
  }

  let sub: { text: string; error: boolean } | null = null;
  if (status === "not_configured") sub = { text: SHEETS_COPY.notConfigured, error: false };
  else if (!connected) {
    sub = waiting
      ? { text: "Connecting…", error: false }
      : outcomeError
        ? { text: outcomeError, error: true }
        : { text: "No email connected", error: false };
  } else if (status === "needs_reconnect") {
    sub = waiting
      ? { text: "Connecting…", error: false }
      : { text: outcomeError ?? SHEETS_COPY.needsReconnect, error: true };
  } else if (status === "sync_stopped") {
    sub = {
      text:
        card.failing.length === 1
          ? lastErrorCopy(card.failing[0]!.lastError)
          : `Sync stopped for ${card.failing.length} projects`,
      error: true,
    };
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className={pageTitle}>Integrations</h1>
        <p className={pageDescription}>
          Connect Routely to the tools your team already uses for reporting.
        </p>
      </header>

      <section aria-labelledby={REPORTING_GROUP.id} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2
            id={REPORTING_GROUP.id}
            className="m-0 flex items-center gap-2 text-xs leading-[18px] font-semibold tracking-[0.04em] text-[#6B7280] uppercase"
          >
            {REPORTING_GROUP.label}
            <span className="text-xs font-semibold tracking-normal text-[#9CA3AF] normal-case">
              1
            </span>
          </h2>
          <p className="m-0 text-[13px] leading-[19px] text-[#6B7280]">{REPORTING_GROUP.desc}</p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
          <article className="relative flex min-w-0 items-center gap-3 rounded-xl border border-[#EEF0F3] bg-white p-4">
            <span
              aria-hidden
              className="inline-flex size-10 flex-[0_0_40px] items-center justify-center rounded-lg bg-[#DCFCE7] text-[#166534]"
            >
              <Svg size={20} strokeWidth={1.8}>
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="M4 9h16" />
                <path d="M4 15h16" />
                <path d="M10 9v12" />
              </Svg>
            </span>
            <div aria-live="polite" className="flex min-w-0 flex-auto flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="m-0 truncate text-sm leading-5 font-semibold text-[#111827]">
                  Google Sheets
                </h3>
                {connected ? (
                  stopped ? (
                    <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-md bg-[#FEF2F2] px-2 text-xs font-semibold whitespace-nowrap text-[#B91C1C]">
                      <span aria-hidden className="size-1.5 rounded-full bg-[#DC2626]" />
                      Sync stopped
                    </span>
                  ) : (
                    <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-md bg-[#DCFCE7] px-2 text-xs font-semibold whitespace-nowrap text-[#166534]">
                      <span aria-hidden className="size-1.5 rounded-full bg-[#16A34A]" />
                      Connected
                    </span>
                  )
                ) : null}
              </div>
              {connected ? (
                <span title={email} className="truncate text-[13px] leading-[18px] text-[#374151]">
                  {email}
                </span>
              ) : null}
              {sub ? (
                <span
                  title={
                    status === "sync_stopped" && card.failing.length === 1
                      ? card.failing[0]!.projectName
                      : undefined
                  }
                  className={cn(
                    "text-[13px] leading-[18px] text-pretty",
                    sub.error ? "text-[#B91C1C]" : "text-[#6B7280]",
                    connected && "line-clamp-2",
                  )}
                >
                  {sub.text}
                </span>
              ) : null}
            </div>
            {showConnect ? (
              <form
                action={GOOGLE_CONNECT_ACTION}
                method="post"
                className="flex flex-none"
                onSubmit={(e) => {
                  if (waiting || !canConnect) {
                    e.preventDefault();
                    return;
                  }
                  setWaiting(true);
                }}
              >
                <button
                  type="submit"
                  disabled={waiting || !canConnect}
                  aria-busy={waiting}
                  aria-label={waiting ? "Connecting your email" : "Connect email for Google Sheets"}
                  title={
                    !card.configured
                      ? SHEETS_COPY.notConfiguredDetail
                      : !card.permissions.manage
                        ? SHEETS_COPY.adminOnly
                        : undefined
                  }
                  className={cn(
                    "inline-flex h-[34px] min-w-[132px] flex-none cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 text-[13px] font-medium whitespace-nowrap text-[#374151] hover:enabled:bg-[#F9FAFB] disabled:cursor-default disabled:opacity-45 max-[641px]:h-10",
                    focusRing,
                  )}
                >
                  {waiting ? (
                    <Spinner />
                  ) : (
                    <>
                      <Svg size={15} className="flex-[0_0_15px]">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="m3 7 9 6 9-6" />
                      </Svg>
                      Connect email
                    </>
                  )}
                </button>
              </form>
            ) : null}
            {connected && !showConnect && card.permissions.manage ? (
              <button
                type="button"
                onClick={() => {
                  setFailure(null);
                  setConfirming(true);
                }}
                className="h-8 flex-none cursor-pointer border-0 bg-transparent px-1 text-[13px] font-medium whitespace-nowrap text-[#B91C1C] outline-none hover:text-[#111827] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
              >
                Disconnect
              </button>
            ) : null}
          </article>
        </div>
      </section>

      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={null}
        alert
        busy={disconnecting}
        width={440}
      >
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1.5">
            <ModalTitleText>Disconnect Google Sheets?</ModalTitleText>
            <p className="m-0 text-[13px] leading-5 text-pretty text-[#6B7280]">
              Routely will remove its access to {email} and stop updating the spreadsheet of every
              project in {card.workspaceName}. Anything already in those spreadsheets stays there,
              and you can reconnect at any time.
            </p>
            {failure ? (
              <p role="alert" className="m-0 text-[13px] leading-5 text-[#B91C1C]">
                {failure}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 max-[641px]:[&>button]:h-11 max-[641px]:[&>button]:flex-auto">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={disconnecting}
              className={btn.secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDisconnect}
              disabled={disconnecting}
              aria-busy={disconnecting}
              className={btn.danger}
            >
              {disconnecting ? <Spinner /> : null}
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      </Modal>

      <ToastHost toast={toast} />
    </div>
  );
}

/** The alert dialog's accessible title, styled as the design's 16px heading. */
function ModalTitleText({ children }: { children: string }) {
  return (
    <AlertDialogPrimitive.Title className="m-0 text-base leading-6 font-semibold text-[#111827]">
      {children}
    </AlertDialogPrimitive.Title>
  );
}

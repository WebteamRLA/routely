"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import type { ElementDescriptor } from "@routely/sdk/contract";

import { ConnectionCard } from "@/components/ab-test/live-editor/connection-card";
import {
  type BridgeState,
  useEditorBridge,
} from "@/components/ab-test/live-editor/use-editor-bridge";
import { CheckIcon, InfoIcon, Spinner, WarningIcon, XIcon } from "@/components/rt/icons";
import { ACCENT_INK, btn, help, mono } from "@/components/rt/styles";
import { EDITOR_MAX_TRACK_SELECTOR, kindLabel } from "@/lib/editor-protocol";
import { shortUrl } from "@/lib/launch-rules";
import { cn } from "@/lib/utils";

export interface PickedElement {
  selector: string;
  label: string;
  /** The page it was chosen on. */
  pageUrl: string;
}

const selectorOf = (element: ElementDescriptor) => element.trackSelector ?? element.selector;
const labelOf = (element: ElementDescriptor) => element.label || kindLabel(element.kind);

const CONNECTING: ReadonlySet<BridgeState["kind"]> = new Set(["starting", "loading", "handshake"]);
/** The page may simply not carry the Routely code. The other failures are not about the code. */
const NO_ANSWER: ReadonlySet<BridgeState["kind"]> = new Set(["no_frame", "not_installed"]);

/**
 * Full-screen element picker: the customer's page on the left (below on a phone), what is pointed
 * at and chosen beside it.
 *
 * It rides the visual editor's bridge (`use-editor-bridge.ts`), so a page that refuses framing
 * falls back to the proxy and then the popup, and every message passes the same origin, window and
 * token checks. The only difference is `routely:pick`, which makes hovering and clicking resolve to
 * the clickable control or the surrounding form, and adds the selector to save.
 *
 * The proxy's copy always answers, because the proxy adds the code itself, so reaching `ready`
 * through it says nothing about the live page. Only an answer from the page itself does.
 */
export function ElementPicker({
  websiteId,
  pageUrl,
  target,
  installHref,
  onUse,
  onCancel,
  onManual,
}: {
  websiteId: string;
  pageUrl: string;
  target: "click" | "form";
  /** The project's install instructions; opened in a new tab so this flow isn't lost. */
  installHref: string;
  onUse(element: PickedElement): void;
  onCancel(): void;
  /** Leaves the picker for the manual selector. */
  onManual(): void;
}) {
  const noun = target === "form" ? "form" : "element";
  const [hovered, setHovered] = useState<ElementDescriptor | null>(null);
  const [selected, setSelected] = useState<ElementDescriptor | null>(null);

  const {
    state: link,
    session,
    attempt,
    via,
    setFrame,
    onFrameLoad,
    openPopup,
    focusPopup,
    retry,
    send,
  } = useEditorBridge({
    enabled: true,
    sessionRequest: { websiteId, pageUrl },
    handlers: {
      onHover: setHovered,
      onSelect: setSelected,
      onApplied: () => {},
    },
  });
  const ready = link.kind === "ready";

  // Read when the page reconnects, without resending on every selection.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });

  // Sent on every (re)connection: a page that reloaded itself starts a fresh agent.
  useEffect(() => {
    if (!ready) return;
    send({ type: "routely:mode", mode: "edit" });
    send({ type: "routely:pick", target });
    send({ type: "routely:highlight", selector: selectedRef.current?.selector ?? null });
  }, [ready, send, target]);

  const shownUrl = session?.pageUrl ?? pageUrl;
  const chosen = selected ? selectorOf(selected) : null;
  const tooLong = chosen !== null && chosen.length > EDITOR_MAX_TRACK_SELECTOR;
  const blocked = !ready && !CONNECTING.has(link.kind);

  const use = () => {
    if (!selected || !chosen || tooLong) return;
    onUse({ selector: chosen, label: labelOf(selected), pageUrl: shownUrl });
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[85] flex flex-col bg-[#EEF0F3] text-[14px] leading-[1.45] text-[#111827] outline-none"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex min-h-[56px] flex-none items-center gap-3 border-b border-[#E5E7EB] bg-white px-4 py-2">
            <div className="flex min-w-0 flex-auto flex-col">
              <DialogPrimitive.Title className="m-0 text-[14px] leading-5 font-semibold text-[#111827]">
                Select the {noun} to track
              </DialogPrimitive.Title>
              <span className="truncate text-[12px] leading-4 text-[#6B7280]">
                {shortUrl(shownUrl)}
              </span>
            </div>
            <button type="button" aria-label="Close" onClick={onCancel} className={btn.icon}>
              <XIcon />
            </button>
          </div>

          <div className="flex min-h-0 flex-auto max-[901px]:flex-col">
            <div className="flex min-h-0 min-w-0 flex-auto flex-col p-4 max-[641px]:p-2">
              <div className="relative min-h-0 flex-auto overflow-hidden rounded-xl bg-white shadow-[0_12px_32px_#1118271F]">
                {session && via !== "popup" ? (
                  <iframe
                    key={attempt}
                    ref={setFrame}
                    src={via === "proxy" ? session.proxyUrl : session.frameUrl}
                    onLoad={onFrameLoad}
                    title={"Your page: " + shortUrl(shownUrl)}
                    // As in the visual editor (`live-visual-editor.tsx`). The proxied copy runs
                    // the customer's scripts from Routely's own host, so it must never get
                    // `allow-same-origin`, here or in the proxy's CSP.
                    sandbox={via === "proxy" ? "allow-scripts" : "allow-scripts allow-same-origin"}
                    allow="local-network-access; local-network; loopback-network"
                    referrerPolicy="strict-origin"
                    className="absolute inset-0 size-full border-0 bg-white"
                  />
                ) : null}
                <ConnectionCard
                  state={link}
                  pageUrl={shownUrl}
                  snippet={session?.snippet ?? "unknown"}
                  tool="element picker"
                  viewer={false}
                  actions={{
                    retry: () => void retry(),
                    openPopup,
                    focusPopup,
                    install: () => window.open(installHref, "_blank", "noopener"),
                  }}
                />
              </div>
            </div>

            <aside
              aria-label={`Choose the ${noun}`}
              className="flex w-[340px] flex-none flex-col border-l border-[#E5E7EB] bg-white max-[901px]:max-h-[46vh] max-[901px]:w-full max-[901px]:border-t max-[901px]:border-l-0"
            >
              <div className="flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto p-[18px]">
                {blocked ? (
                  <Blocked
                    noCode={NO_ANSWER.has(link.kind)}
                    noun={noun}
                    installHref={installHref}
                    onManual={onManual}
                  />
                ) : (
                  <p className={help}>
                    {ready ? (
                      <>
                        Point at the {target === "form" ? "form" : "button or link"} on your page,
                        then click it. The click only chooses it: nothing on the page runs.
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <Spinner size={14} />
                        Connecting to your page…
                      </span>
                    )}
                  </p>
                )}

                {ready ? <PageNote proxied={via === "proxy"} installHref={installHref} /> : null}

                {ready && target === "form" && !hovered && !selected ? (
                  <p className={help}>
                    Nothing highlights? This page may have no form element, or the form may load
                    inside a frame. Try a success page or a form plugin instead.
                  </p>
                ) : null}

                {hovered ? <ElementCard title="Pointing at" element={hovered} /> : null}
                {selected ? <ElementCard title="Selected" element={selected} strong /> : null}
                {tooLong ? (
                  <p className="m-0 text-[13px] leading-[19px] text-[#B91C1C]">
                    This {noun}’s selector is too long to save. Choose one around it, or enter a
                    selector by hand.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-none justify-end gap-2 border-t border-[#EEF0F3] p-3 max-[641px]:[&>*]:h-11 max-[641px]:[&>*]:flex-auto">
                <button type="button" onClick={onCancel} className={btn.secondary}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={use}
                  disabled={!selected || tooLong}
                  className={btn.primary}
                >
                  Use this {noun}
                </button>
              </div>
            </aside>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Whether the live page carries the code, as far as this connection can say. */
function PageNote({ proxied, installHref }: { proxied: boolean; installHref: string }) {
  if (!proxied) {
    return (
      <p className="m-0 flex items-start gap-2 text-[13px] leading-[19px] text-[#166534]">
        <CheckIcon size={15} className="mt-0.5 flex-none" />
        <span>Your page answered, so the Routely code is on it.</span>
      </p>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg bg-[#F0F7FF] px-3 py-2.5 text-[13px] leading-[19px] text-[#374151]">
      <InfoIcon size={15} className="mt-0.5 flex-none" style={{ color: ACCENT_INK }} />
      <span>
        This is a copy of your page, so we can’t tell if the Routely code is on the live one. Events
        only count where it’s installed.{" "}
        <a
          href={installHref}
          target="_blank"
          rel="noopener"
          className="font-medium text-[#0060AD] underline"
        >
          Check the install
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </span>
    </div>
  );
}

function Blocked({
  noCode,
  noun,
  installHref,
  onManual,
}: {
  noCode: boolean;
  noun: string;
  installHref: string;
  onManual(): void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-[#FEF3C7] px-3 py-3 text-[13px] leading-[19px] text-[#92400E]">
      <p className="m-0 flex items-start gap-2 font-semibold">
        <WarningIcon size={15} className="mt-0.5 flex-none" />
        <span>
          {noCode
            ? "We can’t find the Routely code on this page"
            : `We can’t choose the ${noun} right now`}
        </span>
      </p>
      <p className="m-0 text-pretty">
        {noCode
          ? `Choosing the ${noun} here needs the Routely code on the page, and events only count where it’s installed. You can still enter a CSS selector by hand.`
          : "You can still enter a CSS selector by hand."}
      </p>
      {noCode ? (
        <a
          href={installHref}
          target="_blank"
          rel="noopener"
          className="font-medium text-[#92400E] underline"
        >
          See how to install it
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
      <button type="button" onClick={onManual} className={cn(btn.secondary, "self-start")}>
        Enter a selector by hand
      </button>
    </div>
  );
}

function ElementCard({
  title,
  element,
  strong = false,
}: {
  title: string;
  element: ElementDescriptor;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3 py-2.5",
        strong ? "border-[#B3DBFF] bg-[#F0F7FF]" : "border-[#EEF0F3]",
      )}
    >
      <span className="text-[11px] leading-4 font-semibold tracking-[0.04em] text-[#6B7280] uppercase">
        {title}
      </span>
      <span className="text-[13px] leading-[18px] font-semibold [overflow-wrap:anywhere] text-[#111827]">
        {labelOf(element)}
      </span>
      <code
        className={cn(mono, "text-[12px] leading-[17px] [overflow-wrap:anywhere] text-[#4B5563]")}
      >
        {selectorOf(element)}
      </code>
    </div>
  );
}

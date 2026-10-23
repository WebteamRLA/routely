"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EditorAppMessage, ElementDescriptor } from "@routely/sdk/contract";

import {
  type EditorSession,
  appMessage,
  initMessage,
  isFromEditorPage,
  readPageMessage,
} from "@/lib/editor-protocol";

/**
 * The app's side of the visual editor handshake (`@routely/sdk/contract`, "Visual editor bridge").
 *
 *   1. Save the draft (the page URL may have just been typed), then ask the server for an editor
 *      session: a token bound to this experiment, user and the tested page's origin.
 *   2. Frame the page with `#_rt_edit=<token>`. The installed SDK answers with `routely:hello`.
 *   3. Answer the hello with `routely:init`; the SDK then loads `editor-agent.js`, which says
 *      `routely:ready`.
 *
 * Every message is checked three ways before anything reads it (`lib/editor-protocol.ts`): the
 * exact page origin, the very window this editor opened, and the session token.
 *
 * When the page does not answer in the frame, the cause is either a site that forbids framing
 * (`X-Frame-Options` / CSP `frame-ancestors`) or a page without the snippet; a frame cannot tell the
 * two apart from outside. The editor then reloads the frame through Routely's page proxy
 * (`/api/editor/proxy`, when enabled), which serves a copy the frame may show. Only if that does not
 * answer either does it offer the popup — framing rules do not apply there, so a page that does not
 * answer in the popup has no snippet, and only then does the editor say "not installed".
 */

/** `proxy`: the same frame, loading the page through Routely's proxy (a site that refuses framing). */
export type Via = "frame" | "proxy" | "popup";

/** The origin the page's messages come from, and ours go to, in each mode. */
function pageOriginFor(session: EditorSession, via: Via): string {
  return via === "proxy" ? (session.proxyOrigin ?? session.origin) : session.origin;
}

export type BridgeState =
  /** Saving the draft and requesting the session. */
  | { kind: "starting" }
  /** The session request failed (e.g. no valid page URL, a Viewer). */
  | { kind: "failed"; message: string }
  /** The page is loading; waiting for its hello. */
  | { kind: "loading"; via: Via }
  /** Hello answered; waiting for the editor agent to load and say ready. */
  | { kind: "handshake"; via: Via }
  | { kind: "ready"; via: Via }
  /** No hello from the frame: framing forbidden, or no snippet. */
  | { kind: "no_frame" }
  /** No hello from the popup either: the snippet is not on the page. */
  | { kind: "not_installed" }
  | { kind: "popup_blocked" }
  | { kind: "popup_closed" }
  /** The page answered, but the editor agent did not load. */
  | { kind: "agent_missing"; via: Via }
  /** A hello arrived after the session expired. */
  | { kind: "expired" };

/** After the frame's `load`, how long a page with the snippet may take to say hello. */
export const FRAME_GRACE_MS = 4_000;
/** The frame's hard limit, for a page whose `load` never fires. */
export const FRAME_TIMEOUT_MS = 20_000;
/** A popup cannot report its own `load`, so it gets one longer limit. */
export const POPUP_TIMEOUT_MS = 15_000;
/** From `init` to the agent's `ready`. */
export const AGENT_TIMEOUT_MS = 8_000;

export interface BridgeHandlers {
  onHover(element: ElementDescriptor | null): void;
  onSelect(element: ElementDescriptor): void;
  onApplied(results: boolean[]): void;
}

type ApiFailure = { error?: { message?: string } };

async function requestSession(experimentId: string): Promise<EditorSession | string> {
  try {
    const res = await fetch("/api/editor/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ experimentId }),
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as EditorSession | ApiFailure | null;
    if (res.ok && body && "token" in body) return body;
    return (
      (body as ApiFailure | null)?.error?.message ??
      "Something went wrong on our side. Please try again."
    );
  } catch {
    return "We couldn’t reach Routely. Check your connection and try again.";
  }
}

export function useEditorBridge({
  enabled,
  ensureDraft,
  handlers,
}: {
  /** False for a Viewer: nothing is requested and nothing is opened. */
  enabled: boolean;
  /** Flushes the autosave; resolves to the draft id, or null when it could not be saved. */
  ensureDraft(): Promise<string | null>;
  handlers: BridgeHandlers;
}) {
  const [state, setState] = useState<BridgeState>({ kind: "starting" });
  const [session, setSession] = useState<EditorSession | null>(null);
  /** Bumped per attempt, to remount the frame. */
  const [attempt, setAttempt] = useState(0);
  /** Where the page is: the frame until the popup is opened. */
  const [via, setVia] = useState<Via>("frame");

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const viaRef = useRef<Via>("frame");
  const sessionRef = useRef<EditorSession | null>(null);
  const stateRef = useRef<BridgeState>(state);
  const handlersRef = useRef(handlers);
  const ensureRef = useRef(ensureDraft);
  const runRef = useRef(0);
  const timers = useRef<{ wait?: number; agent?: number; closed?: number }>({});

  useEffect(() => {
    handlersRef.current = handlers;
    ensureRef.current = ensureDraft;
  });

  const go = useCallback((next: BridgeState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearTimers = useCallback(() => {
    window.clearTimeout(timers.current.wait);
    window.clearTimeout(timers.current.agent);
    window.clearInterval(timers.current.closed);
    timers.current = {};
  }, []);

  /** The window messages must come from, and go to. */
  const target = useCallback((): Window | null => {
    if (viaRef.current === "popup") return popupRef.current;
    return frameRef.current?.contentWindow ?? null;
  }, []);

  /** Waits for a hello; when none comes, `onTimeout`. */
  const awaitHello = useCallback((ms: number, onTimeout: () => void) => {
    window.clearTimeout(timers.current.wait);
    timers.current.wait = window.setTimeout(() => {
      if (stateRef.current.kind === "loading") onTimeout();
    }, ms);
  }, []);

  /** No hello in the frame: retry through the proxy once, then give up on framing. */
  const frameUnanswered = useCallback(() => {
    if (viaRef.current === "frame" && sessionRef.current?.proxyUrl) {
      viaRef.current = "proxy";
      setVia("proxy");
      setAttempt((n) => n + 1);
      go({ kind: "loading", via: "proxy" });
      awaitHello(FRAME_TIMEOUT_MS, () => go({ kind: "no_frame" }));
      return;
    }
    go({ kind: "no_frame" });
  }, [awaitHello, go]);

  const start = useCallback(async () => {
    const run = ++runRef.current;
    clearTimers();
    popupRef.current?.close();
    popupRef.current = null;
    viaRef.current = "frame";
    setVia("frame");
    go({ kind: "starting" });

    const draftId = await ensureRef.current();
    if (run !== runRef.current) return;
    if (!draftId) {
      go({
        kind: "failed",
        message: "We couldn’t save your draft. Check your connection and try again.",
      });
      return;
    }

    const result = await requestSession(draftId);
    if (run !== runRef.current) return;
    if (typeof result === "string") {
      go({ kind: "failed", message: result });
      return;
    }

    sessionRef.current = result;
    setSession(result);
    setAttempt((n) => n + 1);
    go({ kind: "loading", via: "frame" });
    awaitHello(FRAME_TIMEOUT_MS, frameUnanswered);
  }, [awaitHello, clearTimers, frameUnanswered, go]);

  // The frame finished loading: a page with the snippet has said hello by now, or is about to.
  const onFrameLoad = useCallback(() => {
    if (stateRef.current.kind === "loading" && viaRef.current !== "popup") {
      awaitHello(FRAME_GRACE_MS, frameUnanswered);
    }
  }, [awaitHello, frameUnanswered]);

  /** Opens the page in a popup. Call from a click: browsers only allow popups on a user action. */
  const openPopup = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    clearTimers();
    popupRef.current?.close();

    // Never `noopener`: the page answers `window.opener`, and without it there is no editor.
    const popup = window.open(
      current.frameUrl,
      "routely-visual-editor",
      "popup,width=1280,height=860",
    );
    if (!popup) {
      go({ kind: "popup_blocked" });
      return;
    }
    popupRef.current = popup;
    viaRef.current = "popup";
    setVia("popup");
    go({ kind: "loading", via: "popup" });
    awaitHello(POPUP_TIMEOUT_MS, () => go({ kind: "not_installed" }));
    timers.current.closed = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(timers.current.closed);
      const kind = stateRef.current.kind;
      if (kind === "loading" || kind === "handshake" || kind === "ready") {
        window.clearTimeout(timers.current.wait);
        window.clearTimeout(timers.current.agent);
        go({ kind: "popup_closed" });
      }
    }, 800);
  }, [awaitHello, clearTimers, go]);

  const focusPopup = useCallback(() => popupRef.current?.focus(), []);

  /** The frame's callback ref. */
  const setFrame = useCallback((frame: HTMLIFrameElement | null) => {
    frameRef.current = frame;
  }, []);

  /** Sends to the page once the agent is ready; dropped otherwise (it would not be listening). */
  const send = useCallback(
    (message: Parameters<typeof appMessage>[1]) => {
      const current = sessionRef.current;
      const win = target();
      if (!current || !win || stateRef.current.kind !== "ready") return;
      try {
        win.postMessage(appMessage(current.token, message), pageOriginFor(current, viaRef.current));
      } catch {
        // A closed popup or a navigated frame; the state machine notices separately.
      }
    },
    [target],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const current = sessionRef.current;
      if (!current) return;
      const win = target();
      const origin = pageOriginFor(current, viaRef.current);
      if (!isFromEditorPage(event, { origin, source: win })) return;
      const message = readPageMessage(event.data, current.token);
      if (!message || !win) return;

      const via = viaRef.current;
      switch (message.type) {
        case "routely:hello": {
          window.clearTimeout(timers.current.wait);
          if (Date.now() >= current.expiresAt) {
            go({ kind: "expired" });
            return;
          }
          // Answered on every hello, including a repeat after the page reloaded itself: the
          // agent restarts with it, and the editor re-sends its preview on the next ready.
          const init: EditorAppMessage = initMessage(current.token);
          win.postMessage(init, origin);
          if (stateRef.current.kind !== "handshake") go({ kind: "handshake", via });
          window.clearTimeout(timers.current.agent);
          timers.current.agent = window.setTimeout(() => {
            if (stateRef.current.kind === "handshake") go({ kind: "agent_missing", via });
          }, AGENT_TIMEOUT_MS);
          return;
        }
        case "routely:ready":
          window.clearTimeout(timers.current.agent);
          if (stateRef.current.kind === "handshake") go({ kind: "ready", via });
          return;
        case "routely:error":
          window.clearTimeout(timers.current.agent);
          go({ kind: "agent_missing", via });
          return;
        case "routely:hover":
          if (stateRef.current.kind === "ready") handlersRef.current.onHover(message.element);
          return;
        case "routely:select":
          if (stateRef.current.kind === "ready") handlersRef.current.onSelect(message.element);
          return;
        case "routely:applied":
          if (stateRef.current.kind === "ready") handlersRef.current.onApplied(message.results);
          return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [go, target]);

  useEffect(() => {
    if (!enabled) return;
    // Deferred a tick so StrictMode's mount–unmount–mount starts one session, not two.
    const timer = window.setTimeout(() => void start(), 0);
    return () => {
      window.clearTimeout(timer);
      runRef.current += 1;
    };
  }, [enabled, start]);

  useEffect(
    () => () => {
      clearTimers();
      popupRef.current?.close();
    },
    [clearTimers],
  );

  return {
    state,
    session,
    attempt,
    via,
    setFrame,
    onFrameLoad,
    openPopup,
    focusPopup,
    retry: start,
    send,
  };
}

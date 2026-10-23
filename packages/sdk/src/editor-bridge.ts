import type { EditorAppMessage, EditorPageMessage } from "./contract";
import { EDITOR_HASH_PARAM, EDITOR_PROTOCOL_VERSION } from "./contract";

/**
 * The visual editor's way into a customer's page.
 *
 * The Routely app opens the customer's real page — framed, or in a popup when the site forbids
 * framing — with `#_rt_edit=<token>` in the URL. This module is the part of the main bundle that
 * notices, and it does only one thing with it: a `postMessage` handshake with the Routely app.
 * Only when the app answers does it load `editor-agent.js`, a separate bundle that does the
 * actual editing (and costs every other visitor nothing).
 *
 * The token in the URL is not what makes this safe — anyone can type a fragment. The origin is:
 *
 *  - `hello` is posted with `targetOrigin` set to the app origin, so if whatever framed or opened
 *    this page is not the Routely app, the browser discards the message unread.
 *  - `init` is accepted only from the app origin, only from the window `hello` went to, and only
 *    carrying the same token. A page that frames the customer's site cannot forge `event.origin`.
 *
 * So without the Routely app on the other end, the token does nothing, and the page behaves as
 * the editor never existed — except that this page load skips tracking, which is the right
 * outcome for a URL that asked to be edited. Opened directly in a tab (no parent, no opener), the
 * fragment is ignored and the SDK runs normally.
 *
 * The protocol is defined and documented in `contract.ts`.
 */

/** Tokens are opaque to the page; the shape check only rejects junk early. */
const TOKEN = /^[A-Za-z0-9._~-]{16,1024}$/;

/** `hello` is repeated until answered, in case the app's listener attached late. */
const HELLO_INTERVAL_MS = 500;
const HELLO_ATTEMPTS = 20;

export const AGENT_PATH = "/sdk/v1/editor-agent.js";

/** Handed to the agent through `window.__routelyEditor`. */
export interface EditorContext {
  origin: string;
  token: string;
  /** Which window the app is: the frame's parent, or the popup's opener. */
  via: "parent" | "opener";
}

/** The editor token in `href`'s fragment, if a well-formed one is present. */
export function readEditorToken(href: string): string | null {
  try {
    const hash = new URL(href).hash.slice(1);
    const token = new URLSearchParams(hash).get(EDITOR_HASH_PARAM);
    return token && TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** The window the app is in, if this page was framed or opened by one. */
export function editorTarget(win: Window): { target: Window; via: EditorContext["via"] } | null {
  try {
    if (win.parent && win.parent !== win) return { target: win.parent, via: "parent" };
    if (win.opener) return { target: win.opener as Window, via: "opener" };
  } catch {
    // Fall through.
  }
  return null;
}

/** True when `event` is a genuine `init` for this session. */
export function isInit(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  origin: string,
  target: unknown,
  token: string,
): boolean {
  const data = event.data as Partial<EditorAppMessage> | null;
  return (
    event.origin === origin &&
    event.source === target &&
    typeof data === "object" &&
    data !== null &&
    data.type === "routely:init" &&
    data.token === token
  );
}

/**
 * Starts the handshake. Returns false — and does nothing — when this page was neither framed
 * nor opened by another window, in which case the SDK carries on as normal. Never throws.
 */
export function startEditorBridge(token: string, apiBase: string, win: Window = window): boolean {
  let origin: string;
  try {
    origin = new URL(apiBase).origin;
  } catch {
    return false;
  }

  const found = editorTarget(win);
  if (!found) return false;
  const { target, via } = found;

  const post = (message: EditorPageMessage) => {
    try {
      target.postMessage(message, origin);
    } catch {
      // A closed opener or a detached frame: the editor is gone.
    }
  };

  let answered = false;
  let attempts = 0;
  const href = String(win.location.href).split("#")[0] as string;

  const hello = () => {
    if (answered || attempts >= HELLO_ATTEMPTS) return;
    attempts += 1;
    post({ type: "routely:hello", v: EDITOR_PROTOCOL_VERSION, token, url: href });
    win.setTimeout(hello, HELLO_INTERVAL_MS);
  };

  const onMessage = (event: MessageEvent) => {
    if (answered || !isInit(event, origin, target, token)) return;
    answered = true;
    win.removeEventListener("message", onMessage);

    try {
      const context: EditorContext = { origin, token, via };
      (win as unknown as { __routelyEditor?: EditorContext }).__routelyEditor = context;

      const script = win.document.createElement("script");
      script.src = origin + AGENT_PATH;
      script.async = true;
      script.onerror = () => post({ type: "routely:error", token, code: "agent_load_failed" });
      (win.document.head || win.document.documentElement).appendChild(script);
    } catch {
      post({ type: "routely:error", token, code: "agent_load_failed" });
    }
  };

  try {
    win.addEventListener("message", onMessage);
    hello();
  } catch {
    return false;
  }
  return true;
}

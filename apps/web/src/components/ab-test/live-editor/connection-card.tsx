"use client";

import { type ReactNode, useEffect, useState } from "react";

import { HelpLink } from "@/components/common/help-link";
import { Spinner } from "@/components/rt/icons";
import { shortUrl } from "@/lib/launch-rules";
import { cn } from "@/lib/utils";

import { cls } from "../ui";
import type { BridgeState } from "./use-editor-bridge";

export interface ConnectionActions {
  retry(): void;
  openPopup(): void;
  focusPopup(): void;
  install(): void;
}

/**
 * What the page column says while the live editor connects, and every way it can fail — each with
 * the one action that fixes it. Null when the page itself should show (connected in the frame).
 */
export function ConnectionCard({
  state,
  pageUrl,
  snippet,
  viewer,
  actions,
}: {
  state: BridgeState;
  pageUrl: string;
  /** The last tracking check's verdict on the page, to word a page that does not answer. */
  snippet: "found" | "missing" | "unknown";
  viewer: boolean;
  actions: ConnectionActions;
}): ReactNode {
  const page = shortUrl(pageUrl) || "your page";

  if (viewer) {
    return (
      <Card
        title="Only Editors can use the visual editor"
        body="You can see this version’s saved changes in the list. Ask an Owner, Admin or Editor in this workspace to change them."
      />
    );
  }

  switch (state.kind) {
    case "starting":
      return <Card busy title="Opening your page…" body={`Loading ${page} in the editor.`} />;
    case "failed":
      return (
        <Card title="We couldn’t open the visual editor" body={state.message}>
          <button type="button" onClick={actions.retry} className={cls.secondary}>
            Try again
          </button>
        </Card>
      );
    case "loading":
      return state.via === "popup" ? (
        <Card
          busy
          title="Waiting for your page in the new window…"
          body={`Routely is waiting for the snippet on ${page} to answer.`}
        >
          <button type="button" onClick={actions.focusPopup} className={cls.secondary}>
            Show the window
          </button>
        </Card>
      ) : (
        <Card
          busy
          overlay
          title="Opening your page…"
          body={`Waiting for the Routely snippet on ${page}.`}
        />
      );
    case "handshake":
      return (
        <Card
          busy
          overlay={state.via !== "popup"}
          title="Starting the editor…"
          body="Your page answered. Loading the editor on it."
        />
      );
    case "ready":
      return state.via === "popup" ? (
        <Card
          title="Your page is open in another window"
          body="Hover over the page in that window and click a heading, text, button or image. Your edits show there as you make them. Resize that window to check other screen sizes."
        >
          <button type="button" onClick={actions.focusPopup} className={cls.secondary}>
            Show the window
          </button>
        </Card>
      ) : null;
    case "no_frame":
      return snippet === "missing" ? (
        <Card
          title="Install the Routely snippet on this page to edit it"
          body={`The last check didn’t find the snippet on ${page}, and the page didn’t answer the editor. The visual editor works on your real page, so the snippet has to be there first. If you’ve just installed it, open the page in a new window instead.`}
        >
          <button type="button" onClick={actions.install} className={cls.primary}>
            Install the snippet
          </button>
          <button type="button" onClick={actions.openPopup} className={cls.secondary}>
            Open in a new window
          </button>
        </Card>
      ) : (
        <Card
          title="Your site doesn’t let Routely show it here"
          body={
            snippet === "found"
              ? `${page} has the Routely snippet, but your site doesn’t allow other sites to show it in a frame. Open it in a new window to edit it there.`
              : `Either your site doesn’t allow other sites to show it in a frame, or the Routely snippet isn’t on ${page} yet. Open it in a new window to edit it there.`
          }
          hint="If this address redirects (for example to www.), use the final address as the page URL."
        >
          <button type="button" onClick={actions.openPopup} className={cls.primary}>
            Open in a new window
          </button>
          {snippet === "found" ? null : (
            <button type="button" onClick={actions.install} className={cls.secondary}>
              Install the snippet
            </button>
          )}
        </Card>
      );
    case "not_installed":
      return (
        <Card
          title="Install the Routely snippet on this page to edit it"
          body={`${page} didn’t answer the editor, so the Routely snippet isn’t on it — or it’s an older copy. The visual editor works on your real page, so the snippet has to be there first.`}
          hint="If this address redirects (for example to www.), use the final address as the page URL."
        >
          <button type="button" onClick={actions.install} className={cls.primary}>
            Install the snippet
          </button>
          <button type="button" onClick={actions.retry} className={cls.secondary}>
            Try again
          </button>
        </Card>
      );
    case "popup_blocked":
      return (
        <Card
          title="Your browser blocked the editor window"
          body="Allow pop-ups for Routely in your browser, then open the window again."
        >
          <button type="button" onClick={actions.openPopup} className={cls.primary}>
            Open in a new window
          </button>
        </Card>
      );
    case "popup_closed":
      return (
        <Card
          title="The editor window was closed"
          body="Your unsaved edits are still here. Reopen the window to keep editing."
        >
          <button type="button" onClick={actions.openPopup} className={cls.primary}>
            Reopen the window
          </button>
        </Card>
      );
    case "agent_missing":
      return <AgentMissingCard page={page} retry={actions.retry} />;
    case "expired":
      return (
        <Card
          title="This editing session expired"
          body="Reload the page to keep editing. Your unsaved edits are still here."
        >
          <button type="button" onClick={actions.retry} className={cls.primary}>
            Reload the page
          </button>
        </Card>
      );
  }
}

/**
 * Where the snippet loads the in-page editing tool from, on this app's origin — mirrors
 * `AGENT_PATH` in `packages/sdk/src/editor-bridge.ts`, which is not exported to the app.
 */
const EDITOR_AGENT_PATH = "/sdk/v1/editor-agent.js";

/** `checking` until the probe answers; `unknown` when it could not (offline, say). */
type AgentProbe = "checking" | "absent" | "present" | "unknown";

/**
 * The page answered the handshake — so the snippet is installed and current — but the in-page
 * editing tool never said ready. That is not the customer's snippet: either this server does not
 * serve the tool (it 404s), or the page refused to run it (a Content Security Policy, say). Ask
 * this server which, and only mention the page's policy when the tool is actually there.
 */
function AgentMissingCard({ page, retry }: { page: string; retry(): void }) {
  const [probe, setProbe] = useState<AgentProbe>("checking");
  useEffect(() => {
    let live = true;
    fetch(EDITOR_AGENT_PATH, { method: "HEAD", cache: "no-store" })
      .then((res) => {
        if (live) setProbe(res.status === 404 ? "absent" : "present");
      })
      .catch(() => {
        if (live) setProbe("unknown");
      });
    return () => {
      live = false;
    };
  }, []);

  const answered = `${page} answered the editor, so your snippet is working.`;
  return (
    <Card
      title={
        probe === "absent"
          ? "Routely’s editing tool isn’t available yet"
          : "Routely’s editing tool couldn’t load"
      }
      body={
        probe === "absent"
          ? `${answered} Routely’s in-page editing tool isn’t available on this server yet, so changes can’t be picked on the page for now. Your saved changes are safe.`
          : `${answered} Routely’s in-page editing tool didn’t start on it, though. Try again — your saved changes are safe.`
      }
      hint={
        probe === "present"
          ? `If it keeps happening, your site’s Content Security Policy may be blocking scripts from ${appHost()}.`
          : undefined
      }
    >
      <button type="button" onClick={retry} className={cls.secondary}>
        Try again
      </button>
    </Card>
  );
}

function appHost(): string {
  return typeof window === "undefined" ? "Routely" : window.location.host;
}

function Card({
  title,
  body,
  hint,
  busy = false,
  overlay = false,
  children,
}: {
  title: string;
  body: string;
  hint?: string;
  busy?: boolean;
  /** Over the loading page (translucent) instead of in place of it. */
  overlay?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      role={busy ? "status" : undefined}
      aria-live="polite"
      className={cn(
        "absolute inset-0 flex items-center justify-center p-6",
        overlay ? "bg-white/85" : "bg-white",
      )}
    >
      <div className="flex max-w-[440px] flex-col items-center gap-3 text-center">
        {busy ? <Spinner size={22} className="text-[#0070C9]" /> : null}
        <span className="text-[16px] leading-6 font-semibold text-[#111827]">{title}</span>
        <span className="text-[14px] leading-[22px] text-pretty text-[#4B5563]">{body}</span>
        {hint ? (
          <span className="text-[13px] leading-[19px] text-pretty text-[#6B7280]">{hint}</span>
        ) : null}
        {busy ? null : (
          <HelpLink anchor="editor-wont-load" newTab>
            Visual editor troubleshooting
          </HelpLink>
        )}
        {children ? (
          <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

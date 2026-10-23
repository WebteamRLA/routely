import { describe, expect, it, vi } from "vitest";

import { EDITOR_PROTOCOL_VERSION } from "../src/contract";
import {
  AGENT_PATH,
  editorTarget,
  isInit,
  readEditorToken,
  startEditorBridge,
} from "../src/editor-bridge";

const TOKEN = "tok_abcdefghijklmnop.0123";
const APP = "https://app.routely.test";
const PAGE = `https://acme.test/pricing#_rt_edit=${TOKEN}`;

/** A page window, framed by (or opened from) `app`, with a fake document and event bus. */
function fakePage(options: { framed?: boolean; opened?: boolean } = { framed: true }) {
  const app = { postMessage: vi.fn() };
  const listeners: ((event: unknown) => void)[] = [];
  const appended: { src?: string; onerror?: () => void }[] = [];
  const timers: (() => void)[] = [];

  const win = {
    location: { href: PAGE },
    opener: options.opened ? app : null,
    addEventListener: (_type: string, fn: (event: unknown) => void) => listeners.push(fn),
    removeEventListener: (_type: string, fn: (event: unknown) => void) => {
      listeners.splice(listeners.indexOf(fn), 1);
    },
    setTimeout: (fn: () => void) => timers.push(fn),
    document: {
      createElement: () => ({}) as { src?: string },
      head: { appendChild: (el: { src?: string }) => appended.push(el) },
    },
  } as unknown as Window & { parent: unknown; __routelyEditor?: unknown };
  (win as { parent: unknown }).parent = options.framed ? app : win;

  return {
    win,
    app,
    appended,
    timers,
    dispatch: (event: { origin: string; source: unknown; data: unknown }) =>
      [...listeners].forEach((fn) => fn(event)),
  };
}

describe("readEditorToken", () => {
  it("reads a well-formed token from the fragment", () => {
    expect(readEditorToken(PAGE)).toBe(TOKEN);
    expect(readEditorToken(`https://acme.test/#a=1&_rt_edit=${TOKEN}`)).toBe(TOKEN);
  });

  it("ignores a missing, short or malformed token, and the query string", () => {
    expect(readEditorToken("https://acme.test/pricing")).toBeNull();
    expect(readEditorToken("https://acme.test/#_rt_edit=short")).toBeNull();
    expect(readEditorToken(`https://acme.test/#_rt_edit=<script>${TOKEN}`)).toBeNull();
    expect(readEditorToken(`https://acme.test/?_rt_edit=${TOKEN}`)).toBeNull();
    expect(readEditorToken("not a url")).toBeNull();
  });
});

describe("editorTarget", () => {
  it("prefers the parent frame, then the opener, else nothing", () => {
    expect(editorTarget(fakePage({ framed: true }).win)?.via).toBe("parent");
    expect(editorTarget(fakePage({ opened: true }).win)?.via).toBe("opener");
    expect(editorTarget(fakePage({}).win)).toBeNull();
  });
});

describe("isInit", () => {
  const source = {};
  const init = { type: "routely:init", v: EDITOR_PROTOCOL_VERSION, token: TOKEN };

  it("accepts only the app origin, the app window and the session token", () => {
    expect(isInit({ origin: APP, source, data: init } as never, APP, source, TOKEN)).toBe(true);
    expect(
      isInit({ origin: "https://evil.test", source, data: init } as never, APP, source, TOKEN),
    ).toBe(false);
    expect(isInit({ origin: APP, source: {}, data: init } as never, APP, source, TOKEN)).toBe(
      false,
    );
    expect(
      isInit(
        { origin: APP, source, data: { ...init, token: "other" } } as never,
        APP,
        source,
        TOKEN,
      ),
    ).toBe(false);
    expect(isInit({ origin: APP, source, data: "init" } as never, APP, source, TOKEN)).toBe(false);
  });
});

describe("startEditorBridge", () => {
  it("does nothing on a page that was neither framed nor opened", () => {
    const page = fakePage({});
    expect(startEditorBridge(TOKEN, APP, page.win)).toBe(false);
  });

  it("says hello to the app origin only, and keeps trying a bounded number of times", () => {
    const page = fakePage();
    expect(startEditorBridge(TOKEN, `${APP}/`, page.win)).toBe(true);

    expect(page.app.postMessage).toHaveBeenCalledWith(
      {
        type: "routely:hello",
        v: EDITOR_PROTOCOL_VERSION,
        token: TOKEN,
        url: "https://acme.test/pricing",
      },
      APP,
    );

    for (let i = 0; i < 100 && page.timers.length; i += 1) page.timers.shift()!();
    expect(page.app.postMessage.mock.calls.length).toBe(20);
  });

  it("never loads the agent without a genuine init", () => {
    const page = fakePage();
    startEditorBridge(TOKEN, APP, page.win);

    const init = { type: "routely:init", v: 1, token: TOKEN };
    page.dispatch({ origin: "https://evil.test", source: page.app, data: init });
    page.dispatch({ origin: APP, source: {}, data: init });
    page.dispatch({ origin: APP, source: page.app, data: { ...init, token: "x".repeat(20) } });

    expect(page.appended).toHaveLength(0);
    expect(page.win.__routelyEditor).toBeUndefined();
  });

  it("loads the agent from the app origin once the app answers", () => {
    const page = fakePage({ opened: true });
    startEditorBridge(TOKEN, APP, page.win);

    const init = {
      origin: APP,
      source: page.app,
      data: { type: "routely:init", v: 1, token: TOKEN },
    };
    page.dispatch(init);
    page.dispatch(init);

    expect(page.appended).toHaveLength(1);
    expect(page.appended[0]!.src).toBe(APP + AGENT_PATH);
    expect(page.win.__routelyEditor).toEqual({ origin: APP, token: TOKEN, via: "opener" });

    // Answered: no more hellos.
    const before = page.app.postMessage.mock.calls.length;
    page.timers.forEach((fn) => fn());
    expect(page.app.postMessage.mock.calls.length).toBe(before);
  });

  it("tells the app when the agent bundle cannot be loaded", () => {
    const page = fakePage();
    startEditorBridge(TOKEN, APP, page.win);
    page.dispatch({
      origin: APP,
      source: page.app,
      data: { type: "routely:init", v: 1, token: TOKEN },
    });

    page.appended[0]!.onerror!();
    expect(page.app.postMessage).toHaveBeenLastCalledWith(
      { type: "routely:error", token: TOKEN, code: "agent_load_failed" },
      APP,
    );
  });

  it("refuses an API base that is not a URL", () => {
    expect(startEditorBridge(TOKEN, "not a url", fakePage().win)).toBe(false);
  });

  it("survives an app window that throws on postMessage", () => {
    const page = fakePage();
    page.app.postMessage.mockImplementation(() => {
      throw new Error("detached");
    });
    expect(() => startEditorBridge(TOKEN, APP, page.win)).not.toThrow();
  });
});

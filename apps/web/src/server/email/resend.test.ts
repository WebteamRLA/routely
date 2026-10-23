import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `resend.ts` reads `env`, which validates DATABASE_URL on import, and `after()` from
 * next/server, which needs a request scope. Both are replaced with controllable stand-ins.
 */
const mockEnv = vi.hoisted(() => ({
  NODE_ENV: "development" as "development" | "production" | "test",
  RESEND_API_KEY: undefined as string | undefined,
  EMAIL_FROM: "Routely <mail@routely.test>",
}));
const afterMock = vi.hoisted(() => vi.fn<(task: () => unknown) => void>());

vi.mock("@/env", () => ({ env: mockEnv }));
vi.mock("next/server", () => ({ after: afterMock }));

import {
  RESEND_BATCH_LIMIT,
  type EmailMessage,
  runAfter,
  sendEmail,
  sendEmailAfter,
  sendEmails,
  toResendPayload,
} from "@/server/email/resend";

const message: EmailMessage = {
  to: "kim@acme.test",
  subject: "Reset your Routely password",
  text: "Choose a new password:\nhttps://app.routely.test/reset-password/tok",
  html: "<p>hi</p>",
};

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockEnv.NODE_ENV = "development";
  mockEnv.RESEND_API_KEY = undefined;
  fetchMock.mockReset();
  afterMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("toResendPayload", () => {
  it("matches Resend's POST /emails body: from, to[], subject, text, html, reply_to", () => {
    expect(toResendPayload({ ...message, replyTo: "help@routely.test" }, "R <a@b.test>")).toEqual({
      from: "R <a@b.test>",
      to: ["kim@acme.test"],
      subject: "Reset your Routely password",
      text: message.text,
      html: "<p>hi</p>",
      reply_to: "help@routely.test",
    });
  });

  it("omits reply_to when there is none and flattens a multi-line subject", () => {
    const payload = toResendPayload({ ...message, subject: "a\r\nb" }, "x@y.test");
    expect(payload).not.toHaveProperty("reply_to");
    expect(payload.subject).toBe("a b");
  });
});

describe("sendEmail without RESEND_API_KEY", () => {
  it("prints the message, links included, and reports success without fetching", async () => {
    const result = await sendEmail(message);

    expect(result).toEqual({ ok: true, id: null, via: "console" });
    expect(fetchMock).not.toHaveBeenCalled();
    const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(printed).toContain("To:      kim@acme.test");
    expect(printed).toContain("https://app.routely.test/reset-password/tok");
  });

  it("in production, withholds the body (links are bearer tokens) and reports not sent", async () => {
    mockEnv.NODE_ENV = "production";
    const result = await sendEmail(message);

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    const warned = vi.mocked(console.warn).mock.calls.flat().join("\n");
    expect(warned).not.toContain("reset-password/tok");
  });
});

describe("sendEmail with RESEND_API_KEY", () => {
  beforeEach(() => {
    mockEnv.RESEND_API_KEY = "re_test_123";
  });

  it("POSTs JSON to /emails with a Bearer key and a timeout signal", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }));

    const result = await sendEmail(message);

    expect(result).toEqual({ ok: true, id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794", via: "resend" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer re_test_123",
      "Content-Type": "application/json",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string)).toEqual({
      from: "Routely <mail@routely.test>",
      to: ["kim@acme.test"],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it("returns Resend's error message and status instead of throwing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        statusCode: 422,
        name: "validation_error",
        message: "Invalid `to` field.",
      }),
    );

    const result = await sendEmail(message);

    expect(result).toEqual({ ok: false, error: "Invalid `to` field.", status: 422 });
    expect(console.error).toHaveBeenCalled();
  });

  it("survives a non-JSON error body", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
    expect(await sendEmail(message)).toEqual({ ok: false, error: "HTTP 502", status: 502 });
  });

  it("turns a network failure or timeout into a result", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await sendEmail(message)).toEqual({ ok: false, error: "fetch failed" });

    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await sendEmail(message)).toEqual({ ok: false, error: "timed out after 10000 ms" });
  });

  it("refuses a recipient that is not an address without calling Resend", async () => {
    const result = await sendEmail({ ...message, to: "not an address" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendEmails", () => {
  beforeEach(() => {
    mockEnv.RESEND_API_KEY = "re_test_123";
  });

  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...message, to: `user${i}@acme.test` }));

  it("sends a batch as one array POST to /emails/batch and maps ids in order", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ id: "id-0" }, { id: "id-1" }] }));

    const results = await sendEmails(many(2));

    expect(results).toEqual([
      { ok: true, id: "id-0", via: "resend" },
      { ok: true, id: "id-1", via: "resend" },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails/batch");
    const body = JSON.parse(init?.body as string) as { to: string[] }[];
    expect(body.map((email) => email.to)).toEqual([["user0@acme.test"], ["user1@acme.test"]]);
  });

  it("chunks at Resend's 100-email limit", async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const count = (JSON.parse(init?.body as string) as unknown[]).length;
      return jsonResponse(200, {
        data: Array.from({ length: count }, (_, i) => ({ id: `x${i}` })),
      });
    });

    const results = await sendEmails(many(RESEND_BATCH_LIMIT + 1));

    expect(results).toHaveLength(RESEND_BATCH_LIMIT + 1);
    // 100 in one batch; the lone 101st goes through the single-email endpoint.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.resend.com/emails/batch",
      "https://api.resend.com/emails",
    ]);
  });

  it("marks every message in a failed batch as failed, and keeps invalid ones in place", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { message: "Too many requests" }));

    const results = await sendEmails([...many(2), { ...message, to: "bad" }]);

    expect(results).toEqual([
      { ok: false, error: "Too many requests", status: 429 },
      { ok: false, error: "Too many requests", status: 429 },
      { ok: false, error: "Recipient is not an email address." },
    ]);
  });

  it("falls back to the console per message with no key", async () => {
    mockEnv.RESEND_API_KEY = undefined;
    const results = await sendEmails(many(3));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledTimes(3);
  });
});

describe("scheduling", () => {
  it("sendEmailAfter hands the send to after() and does nothing synchronously", async () => {
    mockEnv.RESEND_API_KEY = "re_test_123";
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "later" }));

    sendEmailAfter(message);

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    await afterMock.mock.calls[0]![0]();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runs detached when after() is unavailable, and logs rather than rejects", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    const task = vi.fn(async () => {
      throw new Error("boom");
    });

    expect(() => runAfter("test task", task)).not.toThrow();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(task).toHaveBeenCalledTimes(1);
  });
});

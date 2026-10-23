import "server-only";

import { after } from "next/server";

import { env } from "@/env";

/**
 * Email delivery through Resend's REST API.
 *
 * One documented endpoint (`POST https://api.resend.com/emails`, plus its `/batch` sibling for
 * notifications) does not justify an SDK dependency — the same stance as the hand-written Google
 * calls in the Sheets integration.
 *
 * Two properties every caller relies on:
 *
 * 1. **Sending never throws.** A failure — no network, a timeout, a 4xx/5xx, a malformed
 *    response — is logged and returned as a `SendResult`. Email is a side effect of an action
 *    (an invite, a password change) whose own result must not depend on Resend being up; an
 *    invite persists either way and can be re-sent.
 * 2. **With no `RESEND_API_KEY`, nothing leaves the machine.** In development the whole message,
 *    links included, is printed to the console so every flow can be completed locally. In
 *    production the body is *not* printed — reset, verification and invite links are bearer
 *    tokens, and platform logs are readable by more people than the recipient's inbox.
 */

const EMAILS_ENDPOINT = "https://api.resend.com/emails";
const BATCH_ENDPOINT = "https://api.resend.com/emails/batch";

/** Resend's documented ceiling for one batch request. */
export const RESEND_BATCH_LIMIT = 100;

/** Long enough for a slow API call, short enough that `after()` work does not pile up. */
const TIMEOUT_MS = 10_000;

export interface EmailMessage {
  /** One recipient per message, so recipients never see each other's addresses. */
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export type SendResult =
  | { ok: true; id: string | null; via: "resend" | "console" }
  | { ok: false; error: string; status?: number };

/** The JSON body Resend's `POST /emails` expects (field names are Resend's, snake_case). */
export interface ResendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  reply_to?: string;
}

export function toResendPayload(message: EmailMessage, from: string): ResendEmailPayload {
  return {
    from,
    to: [message.to],
    // A subject is a header; a stray newline from customer text must not reach it.
    subject: message.subject.replace(/[\r\n]+/g, " "),
    text: message.text,
    html: message.html,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
  };
}

function isPlausibleAddress(address: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+$/.test(address);
}

function logToConsole(message: EmailMessage): SendResult {
  if (env.NODE_ENV === "production") {
    console.warn(
      `[routely] RESEND_API_KEY is not set; email "${message.subject}" was not sent (body withheld from logs).`,
    );
    return { ok: false, error: "Email is not configured." };
  }

  console.log(
    [
      "",
      "──── [routely] email (RESEND_API_KEY not set — printed, not sent) ────",
      `From:    ${env.EMAIL_FROM}`,
      `To:      ${message.to}`,
      ...(message.replyTo ? [`ReplyTo: ${message.replyTo}`] : []),
      `Subject: ${message.subject}`,
      "",
      message.text,
      "──────────────────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
  return { ok: true, id: null, via: "console" };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS} ms` : error.message;
  }
  return String(error);
}

/** Pulls Resend's `{ message }` out of an error body, tolerating anything else. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown; name?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // Not JSON — fall through to the status line.
  }
  return `HTTP ${response.status}`;
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Sends one email. Resolves to a result; never rejects.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  try {
    if (!isPlausibleAddress(message.to)) {
      return { ok: false, error: "Recipient is not an email address." };
    }
    if (!env.RESEND_API_KEY) return logToConsole(message);

    const response = await post(EMAILS_ENDPOINT, toResendPayload(message, env.EMAIL_FROM));

    if (!response.ok) {
      const error = await readErrorMessage(response);
      console.error(`[routely] email "${message.subject}" failed: ${response.status} ${error}`);
      return { ok: false, error, status: response.status };
    }

    const body = (await response.json().catch(() => ({}))) as { id?: unknown };
    return { ok: true, id: typeof body.id === "string" ? body.id : null, via: "resend" };
  } catch (error) {
    const description = describeError(error);
    console.error(`[routely] email "${message.subject}" failed: ${description}`);
    return { ok: false, error: description };
  }
}

/**
 * Sends many emails in as few requests as possible — one per 100, Resend's batch limit.
 *
 * Used for notifications, which fan out to a whole workspace: one request per recipient would
 * run into Resend's per-second rate limit at a handful of members. Resend validates a batch as a
 * unit, so a failure applies to every message in that chunk. Resolves in input order; never
 * rejects.
 */
export async function sendEmails(messages: readonly EmailMessage[]): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (let start = 0; start < messages.length; start += RESEND_BATCH_LIMIT) {
    const chunk = messages.slice(start, start + RESEND_BATCH_LIMIT);
    const sendable = chunk.filter((message) => isPlausibleAddress(message.to));

    if (!env.RESEND_API_KEY || sendable.length <= 1) {
      // Nothing to batch: the single-message path handles the console fallback and one recipient.
      for (const message of chunk) results.push(await sendEmail(message));
      continue;
    }

    let chunkResults: SendResult[];
    try {
      const response = await post(
        BATCH_ENDPOINT,
        sendable.map((message) => toResendPayload(message, env.EMAIL_FROM)),
      );

      if (!response.ok) {
        const error = await readErrorMessage(response);
        console.error(
          `[routely] email batch of ${sendable.length} failed: ${response.status} ${error}`,
        );
        chunkResults = sendable.map(() => ({ ok: false, error, status: response.status }));
      } else {
        const body = (await response.json().catch(() => ({}))) as { data?: unknown };
        const ids = Array.isArray(body.data) ? (body.data as { id?: unknown }[]) : [];
        chunkResults = sendable.map((_, index) => {
          const id = ids[index]?.id;
          return { ok: true, id: typeof id === "string" ? id : null, via: "resend" };
        });
      }
    } catch (error) {
      const description = describeError(error);
      console.error(`[routely] email batch of ${sendable.length} failed: ${description}`);
      chunkResults = sendable.map(() => ({ ok: false, error: description }));
    }

    // Re-interleave with the messages that were rejected before sending.
    let next = 0;
    for (const message of chunk) {
      results.push(
        isPlausibleAddress(message.to)
          ? chunkResults[next++]!
          : { ok: false, error: "Recipient is not an email address." },
      );
    }
  }

  return results;
}

/**
 * Runs `task` after the current response has been sent, so an action never waits on an email.
 *
 * Outside a request scope (a CLI script, a test) `after()` throws; the task then runs detached
 * instead, which is the same thing minus the platform keeping the function alive for it. Either
 * way a rejection is logged, never surfaced.
 */
export function runAfter(label: string, task: () => Promise<unknown>): void {
  const guarded = () =>
    task().then(
      () => undefined,
      (error: unknown) => console.error(`[routely] ${label} failed:`, error),
    );

  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

/** `sendEmail`, scheduled with `after()`. For use inside Server Actions and route handlers. */
export function sendEmailAfter(message: EmailMessage): void {
  runAfter(`email "${message.subject}"`, () => sendEmail(message));
}

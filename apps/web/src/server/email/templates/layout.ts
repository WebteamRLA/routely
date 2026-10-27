/**
 * The shared shape of every Routely email: a plain-text body and a minimal, inline-styled HTML
 * body built from the same blocks, so the two can never say different things.
 *
 * Pure on purpose — no `env`, no `server-only`, no I/O. Every template takes absolute URLs as
 * arguments rather than reading the app origin itself, which keeps them unit-testable under
 * Vitest (importing anything that reaches `env.ts` fails there on a missing `DATABASE_URL`) and
 * puts the decision about *which* origin a link uses in the one place that knows it.
 *
 * Escaping: names of people, workspaces, projects and experiments are customer-controlled text.
 * Every interpolated value goes through `escapeHtml` in the HTML body, and every URL through
 * `safeUrl`, which refuses anything but http(s) — a `javascript:` href in an email is the sort
 * of bug that only has to happen once.
 */

/** What every template returns, and what `sendEmail` takes alongside the recipient. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** A paragraph is a list of segments so a single word can be bold without trusting raw HTML. */
export type Segment = string | { strong: string } | { link: string; url: string };
export type Paragraph = string | readonly Segment[];

export interface EmailContent {
  /** One-line summary shown by mail clients next to the subject. Not rendered visibly. */
  preheader: string;
  heading: string;
  paragraphs: readonly Paragraph[];
  /** A one-time code to type, set large above the button. Digits only. */
  code?: string;
  /** The single primary button. Its URL is also written out in full in both bodies. */
  action?: { label: string; url: string };
  /** Small print under the button: expiry, "if this wasn't you", and the like. */
  notes?: readonly Paragraph[];
  /** Why the recipient got this email, and how to stop it (for opt-out notifications). */
  footer?: readonly Paragraph[];
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for an HTML text node *or* a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Returns the URL unchanged if it is absolute http(s), and throws otherwise.
 *
 * Throwing (rather than dropping the link) is deliberate: every URL here is built by our own
 * code, so a bad one is a programming error that a test should catch, not a value to recover
 * from silently by sending an email whose button goes nowhere.
 */
export function safeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Email link is not an absolute URL: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Email link must be http(s): ${url}`);
  }
  return parsed.toString();
}

/**
 * Makes customer text safe for a subject line: no line breaks (a subject is a header), runs of
 * whitespace collapsed, and a length cap so an 80-character project name cannot push the part
 * of the subject that says what happened out of view.
 */
export function subjectText(value: string, max = 60): string {
  const flat = value
    .replace(/[\r\n\t\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Customer text inside a sentence of the body: one line, trimmed. Escaping happens later. */
export function inlineText(value: string): string {
  return value
    .replace(/[\r\n\t\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Hi Sam," — or "Hi," when there is no usable name. Uses the first word only. */
export function greeting(name: string | null | undefined): string {
  const first = inlineText(name ?? "").split(" ")[0];
  return first ? `Hi ${first},` : "Hi,";
}

const SEGMENTS = (paragraph: Paragraph): readonly Segment[] =>
  typeof paragraph === "string" ? [paragraph] : paragraph;

function paragraphText(paragraph: Paragraph): string {
  return SEGMENTS(paragraph)
    .map((segment) =>
      typeof segment === "string"
        ? segment
        : "strong" in segment
          ? segment.strong
          : `${segment.link} (${safeUrl(segment.url)})`,
    )
    .join("");
}

function paragraphHtml(paragraph: Paragraph): string {
  return SEGMENTS(paragraph)
    .map((segment) =>
      typeof segment === "string"
        ? escapeHtml(segment)
        : "strong" in segment
          ? `<strong style="color:#111827;">${escapeHtml(segment.strong)}</strong>`
          : `<a href="${escapeHtml(safeUrl(segment.url))}" style="color:#4f46e5;">${escapeHtml(segment.link)}</a>`,
    )
    .join("");
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Renders the shared layout. The subject is passed through unchanged; templates build it. */
export function renderEmail(subject: string, content: EmailContent): RenderedEmail {
  const actionUrl = content.action ? safeUrl(content.action.url) : undefined;

  const textParts: string[] = [content.heading, ""];
  for (const paragraph of content.paragraphs) textParts.push(paragraphText(paragraph), "");
  if (content.code) textParts.push(`Your code: ${content.code}`, "");
  if (content.action && actionUrl) textParts.push(`${content.action.label}:`, actionUrl, "");
  for (const note of content.notes ?? []) textParts.push(paragraphText(note), "");
  if (content.footer?.length) {
    textParts.push("—");
    for (const line of content.footer) textParts.push(paragraphText(line));
    textParts.push("");
  }
  textParts.push("Routely");
  const text = textParts.join("\n");

  const p = (inner: string, style: string) => `<p style="margin:0 0 16px;${style}">${inner}</p>`;
  const body = content.paragraphs
    .map((paragraph) =>
      p(paragraphHtml(paragraph), "font-size:15px;line-height:24px;color:#374151;"),
    )
    .join("");

  const code = content.code
    ? `<p style="margin:8px 0 24px;font-size:32px;line-height:40px;font-weight:700;letter-spacing:8px;color:#111827;font-family:Menlo,Consolas,monospace;">${escapeHtml(content.code)}</p>`
    : "";

  const button =
    content.action && actionUrl
      ? `<p style="margin:24px 0;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;line-height:20px;padding:10px 18px;border-radius:8px;">${escapeHtml(content.action.label)}</a></p>` +
        p(
          `Or paste this link into your browser:<br><a href="${escapeHtml(actionUrl)}" style="color:#4f46e5;word-break:break-all;">${escapeHtml(actionUrl)}</a>`,
          "font-size:13px;line-height:20px;color:#6b7280;",
        )
      : "";

  const notes = (content.notes ?? [])
    .map((note) => p(paragraphHtml(note), "font-size:13px;line-height:20px;color:#6b7280;"))
    .join("");

  const footer = content.footer?.length
    ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;">` +
      content.footer
        .map((line) =>
          p(
            paragraphHtml(line),
            "font-size:12px;line-height:18px;color:#9ca3af;margin-bottom:4px;",
          ),
        )
        .join("")
    : "";

  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f9fafb;">` +
    `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(content.preheader)}</div>` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:${FONT};">` +
    `<div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:24px;">Routely</div>` +
    `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px 28px;">` +
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;color:#111827;">${escapeHtml(content.heading)}</h1>` +
    body +
    code +
    button +
    notes +
    footer +
    `</div></div></body></html>`;

  return { subject, text, html };
}

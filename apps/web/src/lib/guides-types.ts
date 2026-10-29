/**
 * The shapes of Help & Guides content (`lib/guides.ts`) and the one way to link into it.
 *
 * Contextual help, the Dashboard checklist and the guides themselves link by **anchor**, never by a
 * hand-written URL: `GUIDE_OF` says which guide each anchor lives in, `guideHref` builds the link,
 * and a unit test checks that every anchor exists as a section — so a renamed section is a failing
 * test, not a dead link.
 */

import type { Shot } from "@/lib/guide-shots";

/** A run of text; `code` renders monospace, `strong` bold. Never raw HTML. */
export type Inline = string | { code: string } | { strong: string };
export type Text = string | readonly Inline[];

/** One screen, by step: what to do, and what it looks like. */
export interface WalkStep {
  title: string;
  text: Text;
  shot?: Shot;
}

export type Block =
  | { kind: "p"; text: Text }
  /** A screenshot of the real screen. */
  | { kind: "shot"; shot: Shot; caption?: string }
  /** The main way to show a task: numbered steps, each with its screenshot, Previous / Next. */
  | { kind: "walkthrough"; steps: readonly WalkStep[] }
  /** Numbered, in order — what to click, in the words on the screen. */
  | { kind: "steps"; items: readonly Text[] }
  | { kind: "list"; items: readonly Text[] }
  | { kind: "note"; tone: "info" | "tip" | "warn"; title: string; text: Text }
  | { kind: "code"; label: string; code: string }
  /** A worked example: a scenario and how it is set up. */
  | { kind: "example"; title: string; items: readonly Text[] }
  /** Problem → what to check, for troubleshooting. */
  | { kind: "faq"; items: readonly { q: string; a: readonly Text[] }[] };

export interface GuideSection {
  id: GuideAnchor;
  title: string;
  blocks: readonly Block[];
}

export interface Guide {
  slug: GuideSlug;
  title: string;
  /** One line for the Help index. */
  summary: string;
  sections: readonly GuideSection[];
}

export const GUIDE_SLUGS = [
  "getting-started",
  "projects-and-tracking",
  "ab-testing",
  "split-url-testing",
  "launch-and-results",
  "troubleshooting",
] as const;
export type GuideSlug = (typeof GUIDE_SLUGS)[number];

/** Every linkable section, and the guide it belongs to. */
export const GUIDE_OF = {
  overview: "getting-started",
  "choose-test": "getting-started",
  projects: "projects-and-tracking",
  "tracking-install": "projects-and-tracking",
  "google-sheets": "projects-and-tracking",
  "ab-create": "ab-testing",
  "visual-editor": "ab-testing",
  "split-create": "split-url-testing",
  "split-urls": "split-url-testing",
  launch: "launch-and-results",
  results: "launch-and-results",
  winner: "launch-and-results",
  "no-visitors": "troubleshooting",
  "tracking-not-found": "troubleshooting",
  "launch-blocked": "troubleshooting",
  "editor-wont-load": "troubleshooting",
  "page-flicker": "troubleshooting",
} as const satisfies Record<string, GuideSlug>;
export type GuideAnchor = keyof typeof GUIDE_OF;

/** Help & Guides is one scrolling page; a link jumps to the section. */
export function guideHref(anchor: GuideAnchor): string {
  return `/help#${anchor}`;
}

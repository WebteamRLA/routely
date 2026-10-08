import { PREVIEW_PARAM } from "./contract";

/**
 * Preview links: `?routely_preview=<experimentId>:<position>`.
 *
 * A preview forces one arm, applies it, and **reports nothing and stores nothing** — the person
 * checking a variant before launch must not become a visitor in its results, and must not be
 * left holding an assignment that would follow them into the live test.
 */

export interface Preview {
  experimentId: string;
  /** The arm to show: 0 is control. */
  position: number;
}

/** Reads the preview request from a URL. Malformed values are ignored, never guessed at. */
export function readPreview(href: string): Preview | null {
  try {
    const raw = new URL(href).searchParams.get(PREVIEW_PARAM);
    if (!raw) return null;
    const colon = raw.lastIndexOf(":");
    const experimentId = colon < 0 ? raw : raw.slice(0, colon);
    const position = colon < 0 ? 0 : Number(raw.slice(colon + 1));
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(experimentId)) return null;
    if (!(position >= 0 && position <= 20 && position % 1 === 0)) return null;
    return { experimentId, position };
  } catch {
    return null;
  }
}

/** Carries the preview onto a redirect target, so the destination also stays silent. */
export function withPreview(target: string, preview: Preview): string {
  try {
    const url = new URL(target);
    url.searchParams.set(PREVIEW_PARAM, `${preview.experimentId}:${preview.position}`);
    return url.toString();
  } catch {
    return target;
  }
}

/**
 * The URL without the preview parameter, for comparing against an arm URL. The redirect target
 * carries the parameter (see `withPreview`), so without this the variant page would never be
 * "the page already displayed" and would redirect to itself forever.
 */
export function withoutPreview(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.delete(PREVIEW_PARAM);
    return url.toString();
  } catch {
    return href;
  }
}

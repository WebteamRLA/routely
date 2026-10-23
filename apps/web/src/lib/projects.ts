/**
 * Projects — the row shape the Projects screen renders and the pure rules it runs on.
 *
 * A project is one website (the design's name for what the database calls `websites`). The rows
 * come from `project.service.listProjectsWithStats`; the validation rules here are the single
 * statement of what a valid project name and address are, shared by the dialogs (instant
 * feedback) and `validation/website.ts` (the server's authority), so the two cannot disagree.
 *
 * Pure and dependency-light (only other pure `lib/` modules): client components import it.
 */

import { relativeTime } from "@/lib/experiment-time";
import type { TrackingState } from "@/lib/pixel-status";

/**
 * The design's named states for the Projects screen, addressable as `?view=`. Only states that
 * are purely visual (an open dialog, a prefilled search) remain: loading, error and empty come
 * from the real data now, so a URL can no longer fake them. Lives here, not in the client
 * component: a server page importing a value from a "use client" module gets a client reference,
 * not the array.
 */
export const PROJECTS_VIEWS = [
  "list",
  "create",
  "createErrors",
  "created",
  "edit",
  "tracking",
  "delete",
  "noResults",
] as const;
export type ProjectsViewName = (typeof PROJECTS_VIEWS)[number];

export type TrackingStatus = "active" | "stale" | "none";

/** `lib/pixel-status.ts`'s state names → the design's. */
export function trackFromState(state: TrackingState): TrackingStatus {
  if (state === "active") return "active";
  if (state === "not_seen") return "stale";
  return "none";
}

export interface Project {
  id: string;
  name: string;
  domain: string;
  /** Scheme the site is served over — prefills the pixel check's URL. */
  protocol: "HTTPS" | "HTTP";
  /** Avatar tile: the letter, its background and its ink. */
  initial: string;
  color: string;
  ink: string;
  /** Public site id embedded in the tracking snippet — shown as the "Project ID". */
  key: string;
  track: TrackingStatus;
  /** Second line under the tracking badge, e.g. "Last seen 4 min ago". */
  seen: string;
  running: number;
  total: number;
  /** Distinct visitors over the last 30 days; null when nothing has been recorded. */
  visitors: number | null;
  /** "Mar 4, 2025" */
  created: string;
  /** Who added it; "a former member" once their account is gone. */
  createdBy: string;
}

/** Avatar palette, indexed by `Website.colorIndex` (0–4, `count % 5` at creation). */
export const PROJECT_PALETTE: readonly (readonly [string, string])[] = [
  ["#CCFBF1", "#115E59"],
  ["#FCE7F3", "#9D174D"],
  ["#DCFCE7", "#166534"],
  ["#FEF3C7", "#92400E"],
  ["#E6F4FF", "#0060AD"],
];

/** Tile colours and letter for a project. */
export function projectTile(
  name: string,
  colorIndex: number,
): { initial: string; color: string; ink: string } {
  const slot = PROJECT_PALETTE.length;
  const index = ((Math.trunc(colorIndex) % slot) + slot) % slot;
  const [color, ink] = PROJECT_PALETTE[index]!;
  return { initial: name.trim().charAt(0).toUpperCase() || "?", color, ink };
}

/** The palette slot a new project gets: the number of projects already in the workspace, mod 5. */
export function nextColorIndex(existingProjects: number): number {
  return Math.max(0, existingProjects) % PROJECT_PALETTE.length;
}

/**
 * How long ago a project was last seen, as the Projects table and the Dashboard word it:
 * "just now", "4 min ago", "3 h ago", "25 days ago". (The project dashboard's badge keeps
 * `trackingStatus`'s compact "25 d ago", as its design does.)
 */
export function seenAgo(seenAt: Date | null, now: Date): string | null {
  if (!seenAt) return null;
  const short = relativeTime(seenAt, now, "short");
  return short.endsWith(" d ago") ? relativeTime(seenAt, now, "long") : short;
}

/** The "Last seen …" line under a tracking badge. */
export function trackingSeenLine(track: TrackingStatus, when: string | null): string {
  if (track === "none" || !when) return "Snippet not installed";
  return `Last seen ${when}`;
}

export interface TrackMeta {
  label: string;
  bg: string;
  fg: string;
  dot: string;
}

export function trackMeta(track: TrackingStatus): TrackMeta {
  if (track === "active") return { label: "Active", bg: "#DCFCE7", fg: "#166534", dot: "#16A34A" };
  if (track === "stale") return { label: "Not seen", bg: "#FEF3C7", fg: "#92400E", dot: "#F59E0B" };
  return { label: "Not installed", bg: "#F3F4F6", fg: "#4B5563", dot: "#9CA3AF" };
}

// ---------------------------------------------------------------------------------------------
// Name and address rules (client and server agree; `validation/website.ts` wraps these in Zod)
// ---------------------------------------------------------------------------------------------

export const PROJECT_NAME_MAX = 60;

/**
 * What a typed address is stored as: trimmed, lower-cased, without `http(s)://`, `www.`, a port,
 * or anything from the first `/`, `?` or `#`.
 * "https://www.Shop.example.com:8080/path" → "shop.example.com".
 *
 * The port goes because a project is a host, not an origin: `isSameSite` compares hostnames, so a
 * stored port would make every page of the site look foreign. (The design's pattern accepted a
 * port; it is accepted here too, and dropped.)
 */
export function normalizeDomain(input: string): string {
  const trimmed = String(input || "")
    .trim()
    .toLowerCase();
  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!
    .replace(/:\d*$/, "");
}

/** The design's address pattern, port removed (see `normalizeDomain`). */
const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

/** Longest hostname DNS allows. */
const DOMAIN_MAX = 253;

/** The scheme a typed address implies: `http://` means HTTP, anything else HTTPS. */
export function protocolFromAddress(input: string): "HTTPS" | "HTTP" {
  return /^\s*http:\/\//i.test(String(input || "")) ? "HTTP" : "HTTPS";
}

/** "" when valid. */
export function projectNameError(input: string): string {
  const name = String(input ?? "").trim();
  if (!name) return "Give your project a name.";
  if (name.length > PROJECT_NAME_MAX) return "Use 60 characters or fewer.";
  return "";
}

/** "" when valid. Format only — duplicates need the other projects (`projectFormErrors`). */
export function projectAddressError(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "Enter your website’s address.";
  const domain = normalizeDomain(raw);
  if (domain.length > DOMAIN_MAX || !DOMAIN_RE.test(domain)) {
    return "Enter a valid address, like example.com.";
  }
  return "";
}

export interface ProjectFormErrors {
  name: string;
  url: string;
}

/** The fields the duplicate rules compare against. */
export type ProjectIdentity = Pick<Project, "id" | "name" | "domain">;

/** The other project already using this name (case-insensitive), if any. */
export function duplicateName<T extends ProjectIdentity>(name: string, others: readonly T[]) {
  const wanted = name.trim().toLowerCase();
  return others.find((p) => p.name.trim().toLowerCase() === wanted) ?? null;
}

/** The other project already using this (normalised) domain, if any. */
export function duplicateDomain<T extends ProjectIdentity>(domain: string, others: readonly T[]) {
  return others.find((p) => p.domain === domain) ?? null;
}

/** Empty strings mean "valid". `excludeId` is the project being edited, if any. */
export function projectFormErrors(
  form: { name: string; url: string },
  projects: readonly ProjectIdentity[],
  excludeId: string | null = null,
): ProjectFormErrors {
  const others = projects.filter((p) => p.id !== excludeId);
  const errors: ProjectFormErrors = { name: projectNameError(form.name), url: "" };

  if (!errors.name) {
    const dup = duplicateName(form.name, others);
    if (dup) errors.name = `You already have a project called “${dup.name}”.`;
  }

  errors.url = projectAddressError(form.url);
  if (!errors.url) {
    const domain = normalizeDomain(form.url);
    const dup = duplicateDomain(domain, others);
    if (dup) errors.url = `${domain} is already used by “${dup.name}”.`;
  }

  return errors;
}

/** "Fix 2 issues to create this project." — the create dialog's banner when more than one fails. */
export function fixIssuesMessage(count: number): string {
  return `Fix ${count} issues to create this project.`;
}

// ---------------------------------------------------------------------------------------------
// Pixel check URL
// ---------------------------------------------------------------------------------------------

/**
 * Validates the page URL typed into the pixel verification step. Empty string = valid.
 *
 * The design required the host to equal the project's domain exactly; the server's rule
 * (`isSameSite`) also accepts subdomains, and the server wins (spec §8 row 12) — so this does
 * too, with the design's copy for anything else.
 */
export function pixelUrlError(url: string, domain: string): string {
  const t = String(url || "").trim();
  if (!t) return "Enter the URL of a page on your site.";
  const m = /^(https?:\/\/)?([^/\s?#]+)([/?#]\S*)?$/i.exec(t);
  if (!m || !/^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?$/i.test(m[2]!)) {
    return `Enter a valid URL, like https://${domain}/`;
  }
  const host = m[2]!.toLowerCase().replace(/:\d+$/, "");
  const bare = host.replace(/^www\./, "");
  if (bare !== domain && !host.endsWith(`.${domain}`)) {
    return `This project tracks ${domain}. Enter a page on that site.`;
  }
  return "";
}

/** The URL the check is sent for: a scheme is added when the customer left it out. */
export function pixelCheckUrl(url: string, protocol: "HTTPS" | "HTTP"): string {
  const t = String(url || "").trim();
  return /^https?:\/\//i.test(t) ? t : `${protocol === "HTTP" ? "http" : "https"}://${t}`;
}

/** The prefilled page URL: `{protocol}://{domain}/`. */
export function pixelDefaultUrl(domain: string, protocol: "HTTPS" | "HTTP"): string {
  return `${protocol === "HTTP" ? "http" : "https"}://${domain}/`;
}

export function formatCount(n: number | null): string {
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

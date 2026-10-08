import type { ReactNode } from "react";

import { Spinner } from "@/components/rl";
import { URL_RE, hostOf } from "@/lib/domain-normalize";
import { cn } from "@/lib/utils";

import type { UrlCheckEntry } from "./types";

/** Wizard step heading: Sora 20px H2 + grey sub. */
export function StepHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <h2 className="m-0 mb-1.5 font-heading text-xl font-bold tracking-[-0.015em]">{title}</h2>
      {children ? <div className="text-pretty text-ink-3">{children}</div> : null}
    </div>
  );
}

/** Text of a finished URL check, in the prototype's three tones. */
export function describeUrlCheck(
  entry: UrlCheckEntry,
  url: string,
): { state: "ok" | "warn" | "checking"; text: string } {
  if (entry.pending) return { state: "checking", text: "Checking URL…" };
  if (!entry.result) return { state: "warn", text: entry.error };
  const r = entry.result;
  const host = hostOf(url.trim()) || "this page";
  const code = r.status ? `${r.status} OK` : "OK";
  if (!r.ok) {
    return {
      state: "warn",
      text:
        (r.message || "We couldn’t reach this URL.") +
        (r.status && !(r.message ?? "").includes(String(r.status)) ? ` (HTTP ${r.status})` : ""),
    };
  }
  if (!r.onProjectDomain) {
    return {
      state: "warn",
      text: `Reachable · ${code}, but ${host} isn’t one of this project’s domains.`,
    };
  }
  if (r.snippetFound === false) {
    return {
      state: "warn",
      text: `Reachable, but the Routely script was not found on ${host}. Install it before launch.`,
    };
  }
  if (r.snippetFound === true) {
    return { state: "ok", text: `Reachable · ${code} · Routely script detected on ${host}` };
  }
  return { state: "ok", text: `Reachable · ${code}` };
}

/** The line under a URL field after its real check ran (hidden while the field has an error). */
export function UrlCheckLine({
  entry,
  url,
  withIcon = true,
}: {
  entry: UrlCheckEntry | undefined;
  url: string;
  withIcon?: boolean;
}) {
  // While the URL is checkable but unchecked, hold the line's height: the check starts on blur,
  // and a line appearing then would push the Continue button out from under a click in progress.
  if (!entry) {
    return URL_RE.test(url.trim()) ? (
      <span aria-hidden className="invisible text-[12.5px] font-semibold">
        Checking URL…
      </span>
    ) : null;
  }
  const { state, text } = describeUrlCheck(entry, url);
  return (
    <span
      role="status"
      className={cn(
        "flex items-center gap-1.5 text-[12.5px] font-semibold",
        state === "ok" ? "text-success-text" : state === "warn" ? "text-[#94600A]" : "text-ink-3",
      )}
    >
      {withIcon ? (
        state === "checking" ? (
          <Spinner size={12} />
        ) : (
          <span aria-hidden>{state === "ok" ? "✓" : "!"}</span>
        )
      ) : null}
      <span>{text}</span>
    </span>
  );
}

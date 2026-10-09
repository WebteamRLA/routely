"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/rl";
import {
  domainResult,
  listDomains,
  problemSentence,
  problemsOf,
  summariseProblems,
  type DomainResult,
} from "@/components/tracking/install-check";
import type { InstallInfo } from "@/components/tracking/types";
import { cn } from "@/lib/utils";
import { checkInstallOnPageAction } from "@/server/actions/pixel.actions";

/**
 * Settings → Installation & tracking, and the body of the install modal (design v2).
 *
 * "Verify installation" is real: every project domain's home page is fetched server-side
 * (`checkInstallOnPageAction`, the existing pixel check) and searched for this project's site id.
 * A successful check is recorded on the project, so the status survives a reload. The design has
 * no per-domain list, so a check that misses any domain is summarised in one line under the
 * buttons: red when the snippet was found nowhere, amber when it was found on some domains (or was
 * confirmed earlier) but not on these.
 */

export interface InstallPanelProps {
  install: InstallInfo;
  projectName: string;
  /** Extra controls beside the status badge (the modal's × button). */
  headerAside?: ReactNode;
  /** Rendered after the panel (the modal's sticky footer); receives the installed state. */
  footer?: (installed: boolean) => ReactNode;
  /**
   * Visual-editor mode: the host the editor wants to open. Shows the amber "Install Routely to
   * open the visual editor" note above the snippet.
   */
  editorHost?: string;
  /** Called once, when a verification run from this panel detects the snippet. */
  onVerified?: () => void;
  className?: string;
}

export function InstallPanel({
  install,
  projectName,
  headerAside,
  footer,
  editorHost,
  onVerified,
  className,
}: InstallPanelProps) {
  const router = useRouter();
  // Results of the last check run in this session; null until the customer verifies.
  const [results, setResults] = useState<Record<string, DomainResult> | null>(null);
  const [checking, setChecking] = useState(false);
  const verifiedOnce = useRef(false);
  const pre = useRef<HTMLPreElement>(null);

  const primary = install.domains[0] ?? "your site";
  const found = results ? install.domains.filter((d) => results[d]?.kind === "found") : [];
  const problems = results ? problemsOf(install.domains, results) : [];
  // A failed check never erases an installation confirmed earlier (the server keeps the same rule).
  const ok = install.installed || found.length > 0;
  const trackingOk = ok && !checking;
  // The green line names a domain the snippet was actually seen on. A check this session that found
  // it nowhere contradicts "ready on …", so the line steps aside for the amber explanation.
  const showReady = trackingOk && (!results || found.length > 0);
  const readyOn = found[0] ?? primary;
  const problemText = checking ? null : summariseProblems(problems);

  async function verify() {
    if (checking) return;
    setChecking(true);

    const checked = await Promise.all(
      install.domains.map(async (domain): Promise<[string, DomainResult]> => {
        try {
          const result = await checkInstallOnPageAction({
            websiteId: install.projectId,
            url: `${install.protocol}://${domain}/`,
          });
          return [domain, domainResult(result)];
        } catch {
          return [domain, { kind: "error", message: "We couldn’t check that page." }];
        }
      }),
    );

    const next = Object.fromEntries(checked);
    setResults(next);
    setChecking(false);

    const detected = install.domains.find((d) => next[d]?.kind === "found");
    if (!detected) return;
    const first = Boolean(onVerified) && !verifiedOnce.current;
    toast(
      first && editorHost
        ? "Routely verified · opening the visual editor"
        : `Routely snippet detected on ${detected}`,
    );
    router.refresh();
    if (first) {
      verifiedOnce.current = true;
      onVerified?.();
    }
  }

  const badge = checking
    ? { label: "Checking…", cls: "border-[#D5DEFB] bg-brand-tint text-[#1F3FB0]", icon: null }
    : ok
      ? {
          label: "Installed",
          cls: "border-success-border bg-success-bg text-success-strong",
          icon: "✓",
        }
      : {
          label: "Not installed",
          cls: "border-danger-border bg-danger-bg-2 text-danger-text",
          icon: "✕",
        };

  return (
    <>
      <div className={cn("overflow-hidden", className)}>
        <div className="flex flex-wrap items-start justify-between gap-3.5 border-b border-divider px-[22px] py-5">
          <div className="min-w-0 flex-[1_1_300px]">
            <h2 className="m-0 font-heading text-[17px] font-bold tracking-[-0.01em]">
              Install the Routely snippet
            </h2>
            <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-2">
              Install once per website. Shared by every experiment in {projectName}.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span
              role="status"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-sm border px-3 text-[12.5px] font-extrabold whitespace-nowrap",
                badge.cls,
              )}
            >
              {checking ? <Spinner size={12} /> : <span aria-hidden>{badge.icon}</span>}
              {badge.label}
            </span>
            {headerAside}
          </div>
        </div>

        <div className="flex flex-col gap-3.5 px-[22px] pt-5 pb-[22px]">
          {editorHost ? (
            <div className="flex items-start gap-2.5 rounded-md border border-warning-border bg-warning-bg px-3.5 py-3 text-[13px] leading-[1.5] text-[#7A4E07]">
              <span aria-hidden className="font-black">
                !
              </span>
              <span>
                <b>Install Routely to open the visual editor.</b> Add the snippet below to{" "}
                {editorHost}, then verify. The editor opens automatically once it’s detected.
              </span>
            </div>
          ) : null}

          <pre
            ref={pre}
            className="m-0 rounded-lg bg-navy px-[18px] py-4 font-mono text-[13px] leading-[1.6] break-all whitespace-pre-wrap text-[#C9D6FF] [font-variant-ligatures:none]"
          >
            {install.snippet}
          </pre>
          <div className="text-[13px] text-ink-2">
            Paste it in the &lt;head&gt; of every page on {listDomains(install.domains)}.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton code={install.snippet} fallback={pre} />
            <button
              type="button"
              onClick={verify}
              disabled={checking}
              className={cn(
                "flex h-[38px] cursor-pointer items-center gap-2 rounded-md border px-4 text-[13.5px] font-extrabold outline-none focus-visible:ring-3 focus-visible:ring-primary/30 disabled:cursor-wait",
                checking
                  ? "border-brand bg-brand-tint text-brand"
                  : ok
                    ? "border-input bg-card text-foreground hover:bg-[#F5F6F9]"
                    : "border-brand bg-brand text-white hover:bg-brand-hover",
              )}
            >
              {checking ? <Spinner size={13} /> : null}
              {checking ? "Checking…" : ok ? "Verify again" : "Verify installation"}
            </button>
          </div>

          <div aria-live="polite" className="contents">
            {showReady ? (
              <div className="flex items-center gap-2.5 rounded-md border border-success-border bg-success-bg-2 px-3.5 py-3 text-[13.5px] font-bold text-success-strong">
                <span
                  aria-hidden
                  className="grid size-[22px] shrink-0 place-items-center rounded-full bg-success text-xs font-black text-white"
                >
                  ✓
                </span>
                <span className="min-w-0">Routely is installed and ready on {readyOn}</span>
              </div>
            ) : null}
            {problemText ? (
              <div
                className={cn(
                  "text-[12.5px] leading-[1.5] font-semibold",
                  ok ? "text-warning-text" : "text-danger-text",
                )}
                title={
                  problems.length > 1
                    ? problems.map((p) => `${p.domain}: ${problemSentence(p)}`).join("\n")
                    : undefined
                }
              >
                {problemText}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {footer?.(trackingOk)}
    </>
  );
}

/**
 * "Copy script" → "Copied ✓" for a moment. Without clipboard access (an insecure origin, a denied
 * permission) it selects the code in `fallback` instead, ready for Ctrl/Cmd+C.
 */
function CopyButton({ code, fallback }: { code: string; fallback: RefObject<HTMLElement | null> }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      const node = fallback.current;
      if (!node) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="h-[38px] cursor-pointer rounded-md border border-input bg-card px-4 text-[13.5px] font-extrabold text-foreground outline-none hover:bg-[#F5F6F9] focus-visible:ring-3 focus-visible:ring-primary/30"
      >
        {copied ? "Copied ✓" : "Copy script"}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}

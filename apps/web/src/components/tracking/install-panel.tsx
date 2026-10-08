"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Bullets, CardTitle, Segmented, Spinner, StepCircle } from "@/components/rl";
import type { InstallInfo } from "@/components/tracking/types";
import type { InstallMethodKey } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { checkInstallOnPageAction } from "@/server/actions/pixel.actions";
import { setInstallMethodAction } from "@/server/actions/project.actions";

/**
 * Settings → Installation & tracking, and the body of the install modal (DESIGN.md 2.7 / 3.7).
 *
 * "Verify installation" is real: every project domain's home page is fetched server-side
 * (`checkInstallOnPageAction`, the existing pixel check) and searched for this project's site id.
 * A successful check is recorded on the project, so the status survives a reload.
 */

type DomainState =
  | { kind: "unknown" }
  | { kind: "checking" }
  | { kind: "ok"; label: string }
  | { kind: "missing"; label: string; message?: string };

const METHOD_LABEL: Record<InstallMethodKey, string> = {
  direct: "Manual",
  gtm: "Google Tag Manager",
};

function initialRows(install: InstallInfo): Record<string, DomainState> {
  const rows: Record<string, DomainState> = {};
  install.domains.forEach((domain, i) => {
    if (i === 0 && install.pixelVerifiedAt) rows[domain] = { kind: "ok", label: "Detected" };
    else if (i === 0 && install.receivingData)
      rows[domain] = { kind: "ok", label: "Receiving data" };
    else rows[domain] = { kind: "unknown" };
  });
  return rows;
}

export function InstallPanel({
  install,
  projectName,
  headerAside,
  successAction,
  footer,
  className,
}: {
  install: InstallInfo;
  projectName: string;
  /** Extra controls beside the status badge (the modal's × button). */
  headerAside?: ReactNode;
  /** Button in the success banner (the modal's "Continue to launch" / "Done"). */
  successAction?: ReactNode;
  /** Rendered after the panel (the modal's sticky footer); receives the installed state. */
  footer?: (installed: boolean) => ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<InstallMethodKey>(install.method);
  // Results of checks run in this session; anything not checked falls back to the server's view.
  const [checked, setRows] = useState<Record<string, DomainState>>({});
  const serverRows = initialRows(install);
  const rows: Record<string, DomainState> = { ...serverRows, ...checked };
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const primary = install.domains[0] ?? "your site";
  const detectedNow = Object.values(rows).some((r) => r.kind === "ok");
  // Where the snippet was actually seen: the first detected domain, else the primary.
  const detectedOn = install.domains.find((d) => rows[d]?.kind === "ok") ?? primary;
  const ok = install.installed || detectedNow;
  const trackingOk = ok && !checking;

  function chooseMethod(next: InstallMethodKey) {
    if (next === method) return;
    const previous = method;
    setMethod(next);
    startTransition(async () => {
      const result = await setInstallMethodAction({ projectId: install.projectId, method: next });
      if (result.status === "error") {
        setMethod(previous);
        toast(result.message);
      }
    });
  }

  async function verify() {
    if (checking) return;
    setChecking(true);
    setNote(null);
    setRows(Object.fromEntries(install.domains.map((d) => [d, { kind: "checking" } as const])));

    const results = await Promise.all(
      install.domains.map(async (domain) => {
        try {
          const result = await checkInstallOnPageAction({
            websiteId: install.projectId,
            url: `${install.protocol}://${domain}/`,
          });
          return [domain, result] as const;
        } catch {
          return [domain, { ok: false as const, message: "We couldn't check that page." }] as const;
        }
      }),
    );

    const next: Record<string, DomainState> = {};
    for (const [domain, result] of results) {
      if (result.ok && result.snippetFound) next[domain] = { kind: "ok", label: "Detected" };
      else if (result.ok && result.wrongSiteId)
        next[domain] = {
          kind: "missing",
          label: "Wrong site id",
          message: `${domain} has a Routely snippet for a different project. Replace it with the snippet above.`,
        };
      else if (result.ok) next[domain] = { kind: "missing", label: "Not detected" };
      else next[domain] = { kind: "missing", label: "Couldn’t load", message: result.message };
    }
    setRows(next);
    setChecking(false);

    const found = install.domains.filter((d) => next[d]?.kind === "ok");
    const firstProblem = install.domains
      .map((d) => next[d])
      .find((r): r is Extract<DomainState, { kind: "missing" }> => r?.kind === "missing");
    setNote(firstProblem?.message ?? null);

    if (found.length > 0) {
      toast(`Routely snippet detected on ${found[0]}`);
      router.refresh();
    } else {
      toast(firstProblem?.message ?? `We couldn’t find the snippet on ${primary}.`);
    }
  }

  const badge = checking
    ? { label: "Checking…", cls: "border-[#D5DEFB] bg-[#F5F8FF] text-[#1F3FB0]", icon: null }
    : ok
      ? {
          label: "Installed",
          cls: "border-success-border bg-[#EAF7F1] text-success-strong",
          icon: "✓",
        }
      : {
          label: "Not installed",
          cls: "border-danger-border bg-[#FDF5F3] text-danger-text",
          icon: "✕",
        };

  const stepDone = ok ? "done" : "todo";
  const howTo =
    method === "gtm"
      ? {
          step1: "Copy the GTM tag code",
          step2: "Add it as a tag in Google Tag Manager",
          code: install.gtmSnippet,
          bullets: [
            "Tags → New → Custom HTML, then paste the code.",
            "Trigger: Initialization – All Pages, so Routely runs before other tags.",
            "Submit and publish the container. Manual install avoids flicker best for A/B tests.",
          ],
        }
      : {
          step1: "Copy your Routely snippet",
          step2: "Add it to your website <head>",
          code: install.snippet,
          bullets: [
            `Works on any website or platform. Paste the snippet as high as possible in the <head> of every page on ${primary}, before other scripts.`,
            "No direct access to the HTML? Use your platform’s custom code, header scripts or theme head area (e.g. “Head code”, “Header scripts”, theme.liquid).",
            "Include every page you test on and every conversion page (e.g. /thank-you). Adding it once to a shared header template covers all pages.",
          ],
        };

  const defaultNote = checking
    ? "Looking for the snippet on each domain…"
    : ok
      ? "Every experiment in this project uses this installation. Nothing to set up per experiment."
      : `Experiments in this project can’t launch until the snippet is detected on ${primary}.`;

  return (
    <>
      <div className={cn("overflow-hidden", className)}>
        <div className="flex flex-wrap items-start justify-between gap-3.5 border-b border-divider px-4 py-5 sm:px-[22px]">
          <div className="min-w-0 flex-[1_1_360px]">
            <h2 className="m-0 font-heading text-[17px] font-bold tracking-[-0.01em]">
              Install the Routely snippet
            </h2>
            <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-2">
              Install once per website. The same snippet powers every A/B test, split URL test and
              goal in {projectName}.
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

        {trackingOk ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-success-border bg-[#F4FBF7] px-4 py-4 sm:px-[22px]">
            <span
              aria-hidden
              className="grid size-[30px] shrink-0 place-items-center rounded-full bg-success font-black text-white"
            >
              ✓
            </span>
            <div className="min-w-0 flex-[1_1_300px]">
              <div className="font-heading text-[15.5px] font-bold text-success-strong">
                Routely is installed and ready
              </div>
              <div className="mt-0.5 text-[13px] text-[#2E5D49]">
                Detected on {detectedOn} · installed via {METHOD_LABEL[method]}. Every experiment in
                this project can launch.
              </div>
            </div>
            {successAction}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-divider bg-subtle px-4 py-4 sm:px-[22px]">
          <span className="text-[12.5px] font-extrabold text-ink-2">Install with</span>
          <Segmented
            size="sm"
            ariaLabel="Install with"
            options={(["direct", "gtm"] as const).map((key) => ({
              value: key,
              label: METHOD_LABEL[key],
            }))}
            value={method}
            onChange={chooseMethod}
          />
        </div>

        <Step n="1" state={stepDone}>
          <CardTitle as="div">{howTo.step1}</CardTitle>
          <InstallCode code={howTo.code} />
        </Step>

        <Step n="2" state={stepDone}>
          <CardTitle as="div">{howTo.step2}</CardTitle>
          <Bullets items={howTo.bullets} />
        </Step>

        <Step n="3" state={ok ? "done" : "current"} last>
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <CardTitle as="div">Verify installation</CardTitle>
            <button
              type="button"
              onClick={verify}
              disabled={checking}
              className={cn(
                "flex h-[38px] cursor-pointer items-center gap-2 rounded-md border px-4 text-[13.5px] font-extrabold outline-none focus-visible:ring-3 focus-visible:ring-primary/30 disabled:cursor-wait",
                checking
                  ? "border-brand bg-[#F5F8FF] text-brand"
                  : ok
                    ? "border-input bg-card text-foreground hover:bg-muted"
                    : "border-brand bg-brand text-white hover:bg-brand-hover",
              )}
            >
              {checking ? <Spinner size={13} /> : null}
              {checking ? "Checking…" : ok ? "Verify again" : "Verify installation"}
            </button>
          </div>
          {install.domains.map((domain) => (
            <DomainRow key={domain} domain={domain} state={rows[domain] ?? { kind: "unknown" }} />
          ))}
          <div className="text-[12.5px] text-ink-3" aria-live="polite">
            {note && !checking ? note : defaultNote}
          </div>
        </Step>
      </div>
      {footer?.(trackingOk)}
    </>
  );
}

function Step({
  n,
  state,
  last,
  children,
}: {
  n: string;
  state: "done" | "current" | "todo";
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-5 sm:gap-4 sm:px-[22px]",
        !last && "border-b border-divider",
      )}
    >
      <StepCircle n={n} state={state} />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">{children}</div>
    </div>
  );
}

function DomainRow({ domain, state }: { domain: string; state: DomainState }) {
  const label =
    state.kind === "unknown"
      ? "Not verified yet"
      : state.kind === "checking"
        ? "Checking…"
        : state.label;
  const tone =
    state.kind === "ok"
      ? "bg-[#E6F5EE] text-success-text"
      : state.kind === "missing"
        ? "bg-[#FCE9E6] text-danger-text"
        : "bg-divider text-ink-2";
  return (
    <div className="flex items-center justify-between gap-2.5 rounded-lg border border-divider px-3 py-2.5">
      <span className="min-w-0 truncate font-mono text-[13px]">{domain}</span>
      <span
        title={state.kind === "missing" ? state.message : undefined}
        className={cn("rounded-sm px-2 py-[3px] text-xs font-extrabold whitespace-nowrap", tone)}
      >
        {label}
      </span>
    </div>
  );
}

/** The design's install code block: wraps long lines (`pre-wrap`, `break-all`) with a blue Copy. */
function InstallCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      const node = pre.current;
      if (!node) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-lg bg-navy px-4 py-3.5">
      <pre
        ref={pre}
        className="m-0 min-w-0 flex-1 font-mono text-[12.5px] leading-[1.6] break-all whitespace-pre-wrap text-[#C9D6FF] [font-variant-ligatures:none]"
      >
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="h-[30px] shrink-0 cursor-pointer rounded-md border-0 bg-brand px-3 text-[12.5px] font-extrabold text-white outline-none hover:bg-[#3D69F5] focus-visible:ring-3 focus-visible:ring-white/40"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

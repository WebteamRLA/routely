"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import {
  type PixelCheckResult,
  type PixelVerify as Verify,
  checkHeader,
  checkRows,
  shortCheckUrl,
  showTips,
  verifyFromResult,
} from "@/lib/pixel-check";
import { pixelCheckUrl, pixelDefaultUrl, pixelUrlError } from "@/lib/projects";
import { buildInstallSnippet } from "@/lib/snippet";
import { cn } from "@/lib/utils";
import { verifyProjectPixelAction } from "@/server/actions/website.actions";

/*
 * Two-step pixel setup: copy the real install snippet (`lib/snippet.ts`, D10), then verify it on a
 * live page through the server's install check (`verifyProjectPixelAction`).
 *
 * A copy of `components/projects/pixel-setup-dialog.tsx` (same design component), extended for
 * the project dashboard: it reports while a check is running so the page's pixel badge can read
 * "Checking pixel…", and tells the page when the script was found so the badge can refresh.
 */

const ACCENT = "#0070C9";
const ACCENT_TINT = "#E6F4FF";
const ACCENT_INK = "#0060AD";
const ACCENT_LINE = "#B3DBFF";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";
const btnBase = `inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg text-[13px] whitespace-nowrap disabled:cursor-default disabled:opacity-45 ${focusRing}`;
const primaryClass = `${btnBase} border-0 bg-[#0070C9] px-4 font-semibold text-white hover:enabled:brightness-[.8]`;
const linkClass = `inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-[13px] font-medium hover:enabled:text-[#111827] disabled:cursor-default disabled:opacity-45 ${focusRing}`;
const monoFont = "font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

export type PixelStep = 1 | 2;
export type { PixelVerify } from "@/lib/pixel-check";
type Step = PixelStep;

export interface PixelTarget {
  id: string;
  domain: string;
  key: string;
  protocol: "HTTPS" | "HTTP";
}

export interface PixelDialogProps {
  project: PixelTarget;
  open: boolean;
  onClose(): void;
  initialStep?: Step;
  /** The SDK URL the snippet loads (`env.SDK_URL`, passed from the server). */
  sdkUrl: string;
  /** The check found this project's script (`pixelVerifiedAt` was stamped). */
  onVerified(): void;
  onCheckingChange(checking: boolean): void;
}

export function PixelDialog({ open, onClose, ...rest }: PixelDialogProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(17,24,39,.28)] p-4">
          <PixelPanel {...rest} onClose={onClose} />
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PixelPanel({
  project,
  initialStep = 1,
  sdkUrl,
  onClose,
  onVerified,
  onCheckingChange,
}: Omit<PixelDialogProps, "open">) {
  const [step, setStep] = useState<Step>(initialStep);
  const [verify, setVerify] = useState<Verify>("idle");
  const [result, setResult] = useState<PixelCheckResult | null>(null);
  const [serverErr, setServerErr] = useState("");
  const [url, setUrl] = useState(pixelDefaultUrl(project.domain, project.protocol));
  const [attempted, setAttempted] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(true);
  const checkingRef = useRef(onCheckingChange);
  useEffect(() => {
    checkingRef.current = onCheckingChange;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(copyTimer.current);
      checkingRef.current(false);
    };
  }, []);

  const checking = verify === "checking";
  const found = verify === "found";
  const domain = project.domain;
  const snippet = buildInstallSnippet({ sdkUrl, publicSiteId: project.key });
  const urlErr = pixelUrlError(url, domain);
  const showUrlErr = attempted && !!urlErr;

  function goTo(n: Step) {
    if (checking) return;
    setStep(n);
    // A found result survives navigation; a miss is cleared when the user goes back to fix it.
    if (n === 1 && verify !== "found") {
      setVerify("idle");
      setResult(null);
    }
  }

  function copy() {
    try {
      void navigator.clipboard?.writeText(snippet).catch(() => {});
    } catch {
      // No clipboard (insecure context, permissions): the snippet stays selectable.
    }
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  async function runCheck(e: React.FormEvent) {
    e.preventDefault();
    if (checking) return;
    setAttempted(true);
    setServerErr("");
    if (urlErr) return;
    setVerify("checking");
    onCheckingChange(true);
    const res = await verifyProjectPixelAction({
      websiteId: project.id,
      url: pixelCheckUrl(url, project.protocol),
    }).catch(() => null);
    if (!mounted.current) return;
    onCheckingChange(false);
    if (!res || !res.ok) {
      // Refused before any fetch (off-site URL, too many checks, no permission): say why under
      // the box, and leave the previous result alone.
      setServerErr(
        res?.fieldErrors?.url ?? res?.message ?? "We couldn’t check that page. Try again.",
      );
      setVerify(result ? verifyFromResult(result) : "idle");
      return;
    }
    setResult(res.data);
    const next = verifyFromResult(res.data);
    setVerify(next);
    if (next === "found") onVerified();
  }

  return (
    <DialogPrimitive.Content
      aria-describedby={undefined}
      className="relative flex h-[720px] max-h-[calc(100vh-32px)] w-full max-w-[680px] animate-[rt-dlg_.16s_ease-out] flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white text-sm leading-[1.45] text-[#111827] shadow-[0_24px_64px_#1118272E] outline-none motion-reduce:animate-none"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#EEF0F3] py-3 pr-3.5 pl-5 max-[641px]:py-2.5 max-[641px]:pr-2.5 max-[641px]:pl-3">
        <ol
          aria-label="Setup steps"
          className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0"
        >
          {(["Install pixel", "Verify"] as const).map((label, i) => {
            const n = (i + 1) as Step;
            const cur = n === step;
            const done = n < step || found;
            return (
              <li key={label} className="flex flex-none items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => goTo(n)}
                  aria-current={cur ? "step" : undefined}
                  disabled={checking}
                  className={cn(
                    "flex h-[34px] cursor-pointer items-center gap-2 rounded-full border-0 pr-3 pl-1.5 text-[13px] whitespace-nowrap disabled:cursor-default disabled:opacity-45",
                    focusRing,
                  )}
                  style={{
                    background: cur ? "#F3F4F6" : "transparent",
                    color: done ? "#166534" : cur ? "#111827" : "#4B5563",
                    fontWeight: cur ? 600 : 500,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex size-[22px] flex-[0_0_22px] items-center justify-center rounded-full text-xs font-semibold"
                    style={{
                      border: `1.5px solid ${done ? "#16A34A" : cur ? ACCENT : "#D1D5DB"}`,
                      background: done ? "#16A34A" : cur ? ACCENT_TINT : "#FFFFFF",
                      color: done ? "#FFFFFF" : cur ? ACCENT_INK : "#6B7280",
                    }}
                  >
                    {done ? <CheckIcon size={11} width={3.2} /> : n}
                  </span>
                  {label}
                </button>
                {n < 2 ? (
                  <span
                    aria-hidden="true"
                    className="block h-0.5 w-6 rounded-sm"
                    style={{ background: step > 1 ? ACCENT_LINE : "#E5E7EB" }}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            "inline-flex size-8 flex-[0_0_32px] cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-[#6B7280] hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)]",
            focusRing,
          )}
        >
          <XIcon size={18} width={2} />
        </DialogPrimitive.Close>
      </div>

      <div className="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto px-7 py-6 max-[641px]:px-4 max-[641px]:py-5">
        {step === 1 ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold"
                  style={{ background: ACCENT_TINT, color: ACCENT_INK }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m8 8-4 4 4 4" />
                    <path d="m16 8 4 4-4 4" />
                  </svg>
                  Manual installation
                </span>
                <span className="text-[13px] text-[#6B7280]">About 5 minutes</span>
              </span>
              <DialogPrimitive.Title className="m-0 text-lg leading-[26px] font-semibold tracking-[-0.01em] text-[#111827]">
                Add the Routely script to your site
              </DialogPrimitive.Title>
              <p className="m-0 text-sm leading-[21px] text-pretty text-[#4B5563]">
                It goes on every page of {domain} you want to test, so Routely can show variants and
                count conversions.
              </p>
            </div>

            <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
              <li className="relative flex min-w-0 items-start gap-3">
                <Connector />
                <StepNum n={1} />
                <div className="flex min-w-0 flex-auto flex-col gap-2.5 pt-0.5">
                  <span className="text-sm leading-[22px] font-semibold text-[#111827]">
                    Copy the script
                  </span>
                  <div className="flex flex-col overflow-hidden rounded-xl border border-[#EEF0F3] bg-[#F3F4F6]">
                    <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] py-1.5 pr-2 pl-3.5">
                      <span className="text-xs leading-[1.45] text-[#6B7280]">
                        Routely tracking script · Project ID {project.key}
                      </span>
                      <button
                        type="button"
                        onClick={copy}
                        className={cn(
                          "inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-[#374151]",
                          focusRing,
                        )}
                        style={{
                          borderColor: copied ? "#BBF7D0" : "#E5E7EB",
                          background: copied ? "#ECFDF5" : "#FFFFFF",
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <rect x="8" y="8" width="13" height="13" rx="2" />
                          <path d="M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1" />
                        </svg>
                        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    <pre
                      className={cn(
                        "m-0 overflow-x-auto px-3.5 pt-3 pb-3.5 text-[13px] leading-[19px] break-normal [overflow-wrap:anywhere] whitespace-pre-wrap text-[#111827]",
                        monoFont,
                      )}
                    >
                      {snippet}
                    </pre>
                  </div>
                </div>
              </li>
              <li className="relative flex items-start gap-3">
                <Connector />
                <StepNum n={2} />
                <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                  <span className="text-sm leading-[22px] font-semibold text-[#111827]">
                    Paste it into the page head
                  </span>
                  <span className="text-sm leading-5 text-pretty text-[#4B5563]">
                    Put it inside the{" "}
                    <code
                      className={cn(
                        "rounded-[5px] bg-[#F3F4F6] px-1.5 py-px text-[13px] text-[#B91C1C]",
                        monoFont,
                      )}
                    >
                      &lt;head&gt;
                    </code>{" "}
                    of every page, as high as you can and before other scripts, so variants show
                    without a flicker.
                  </span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <StepNum n={3} />
                <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                  <span className="text-sm leading-[22px] font-semibold text-[#111827]">
                    Publish your changes
                  </span>
                  <span className="text-sm leading-5 text-pretty text-[#4B5563]">
                    Then continue to check that Routely can see the script.
                  </span>
                </div>
              </li>
            </ol>
          </>
        ) : (
          <VerifyStep
            project={project}
            verify={verify}
            result={result}
            url={url}
            setUrl={(v) => {
              setUrl(v);
              setServerErr("");
            }}
            urlErr={showUrlErr ? urlErr : serverErr}
            onSubmit={runCheck}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF0F3] bg-white px-6 py-3.5 max-[641px]:px-4 max-[641px]:py-3 max-[641px]:*:flex-auto max-[641px]:*:justify-center">
        {step === 1 ? (
          <>
            <button type="button" onClick={onClose} className={cn(linkClass, "text-[#4B5563]")}>
              I’ll set this up later
            </button>
            <button type="button" onClick={() => setStep(2)} className={cn(primaryClass)}>
              Next: Verify installation
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => goTo(1)}
              disabled={checking}
              className={cn(linkClass, "text-[#374151]")}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 12H5" />
                <path d="m11 6-6 6 6 6" />
              </svg>
              Back
            </button>
            {found ? (
              <button type="button" onClick={onClose} className={cn(primaryClass)}>
                Done
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  btnBase,
                  "border border-[#E5E7EB] bg-white px-4 font-medium text-[#374151] hover:enabled:bg-[#F9FAFB]",
                )}
              >
                I’ll finish later
              </button>
            )}
          </>
        )}
      </div>
    </DialogPrimitive.Content>
  );
}

function VerifyStep({
  project,
  verify,
  result,
  url,
  setUrl,
  urlErr,
  onSubmit,
}: {
  project: PixelTarget;
  verify: Verify;
  result: PixelCheckResult | null;
  url: string;
  setUrl(v: string): void;
  urlErr: string;
  onSubmit(e: React.FormEvent): void;
}) {
  const domain = project.domain;
  const key = project.key;
  const checking = verify === "checking";
  const shortUrl = shortCheckUrl(url, domain);

  const TONES = {
    ok: { iconBg: "#DCFCE7", fg: "#166534", icon: "ok" },
    fail: { iconBg: "#FEE2E2", fg: "#B91C1C", icon: "fail" },
    pending: { iconBg: "#F3F4F6", fg: "#9CA3AF", icon: "pending" },
    running: { iconBg: ACCENT_TINT, fg: ACCENT_INK, icon: "running" },
  } as const;
  const checks = checkRows(verify, result, { shortUrl, key, now: new Date() }).map((c) => ({
    title: c.title,
    text: c.text,
    ...TONES[c.tone],
  }));
  const head = checkHeader(verify, result, { shortUrl, domain });

  const styles = {
    found: {
      ink: "#166534",
      bg: "#ECFDF5",
      border: "#BBF7D0",
      pillBg: "#DCFCE7",
      pillFg: "#166534",
      dot: "#16A34A",
    },
    missing: {
      ink: "#B91C1C",
      bg: "#FEF2F2",
      border: "#FECACA",
      pillBg: "#FEE2E2",
      pillFg: "#B91C1C",
      dot: "#DC2626",
    },
    checking: {
      ink: "#111827",
      bg: "#FAFBFC",
      border: "#E5E7EB",
      pillBg: ACCENT_TINT,
      pillFg: ACCENT_INK,
      dot: ACCENT,
    },
    idle: {
      ink: "#111827",
      bg: "#FAFBFC",
      border: "#E5E7EB",
      pillBg: "#F3F4F6",
      pillFg: "#4B5563",
      dot: "#9CA3AF",
    },
  }[head.kind];
  const r = { ...styles, title: head.title, label: head.label };

  const verifyLabel = checking
    ? "Checking…"
    : verify === "missing"
      ? "Check again"
      : verify === "found"
        ? "Verify again"
        : "Verify installation";

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <DialogPrimitive.Title className="m-0 text-lg leading-[26px] font-semibold tracking-[-0.01em] text-[#111827]">
          Verify your installation
        </DialogPrimitive.Title>
        <p className="m-0 text-sm leading-[21px] text-pretty text-[#4B5563]">
          Enter a page on {domain} where you added the script. Routely will load it and confirm the
          script is installed and sending data.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-1.5">
        <label htmlFor="rt-pm-url" className="text-[13px] font-medium text-[#374151]">
          Page URL
        </label>
        <div className="flex flex-wrap gap-2.5">
          <input
            id="rt-pm-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={checking}
            placeholder={`https://${domain}/`}
            aria-invalid={!!urlErr}
            aria-describedby={urlErr ? "rt-pm-url-help" : undefined}
            className="h-11 min-w-0 flex-[1_1_260px] rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF] focus:border-[#0091FF] focus:shadow-[0_0_0_3px_#0091FF1F] aria-invalid:border-[#DC2626] aria-invalid:focus:border-[#DC2626] aria-invalid:focus:shadow-[0_0_0_3px_rgba(220,38,38,.12)]"
          />
          <button type="submit" disabled={checking} className={cn(primaryClass, "h-11 flex-none")}>
            {checking ? <Spinner size={15} width={2.4} /> : null}
            {verifyLabel}
          </button>
        </div>
        {urlErr ? (
          <p
            id="rt-pm-url-help"
            role="alert"
            className="m-0 text-[13px] leading-[19px] text-[#B91C1C]"
          >
            {urlErr}
          </p>
        ) : null}
      </form>

      <section
        aria-labelledby="rt-pm-vs"
        role="status"
        className="flex flex-col overflow-hidden rounded-xl border bg-white"
        style={{ borderColor: r.border }}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-3"
          style={{ background: r.bg, borderColor: r.border }}
        >
          <h3
            id="rt-pm-vs"
            className="m-0 text-sm leading-5 font-semibold [overflow-wrap:anywhere]"
            style={{ color: r.ink }}
          >
            {r.title}
          </h3>
          <span
            className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold whitespace-nowrap"
            style={{ background: r.pillBg, color: r.pillFg }}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{ background: r.dot }}
            />
            {r.label}
          </span>
        </div>
        <ul className="m-0 flex list-none flex-col px-4 py-1">
          {checks.map((c, i) => (
            <li
              key={c.title}
              className="flex items-center gap-3 border-t py-2.5"
              style={{ borderColor: i === 0 ? "transparent" : "#EEF0F3" }}
            >
              <span
                aria-hidden="true"
                className="inline-flex size-[22px] flex-[0_0_22px] items-center justify-center rounded-full"
                style={{ background: c.iconBg, color: c.fg }}
              >
                {c.icon === "ok" ? <CheckIcon size={12} width={3} /> : null}
                {c.icon === "fail" ? <XIcon size={12} width={3} /> : null}
                {c.icon === "running" ? <Spinner size={12} width={3} /> : null}
                {c.icon === "pending" ? (
                  <span className="block size-1.5 rounded-full bg-current" />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <span className="text-sm leading-[19px] font-semibold text-[#111827]">
                  {c.title}
                </span>
                <span className="text-[13px] leading-[19px] [overflow-wrap:anywhere] text-[#6B7280]">
                  {c.text}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {showTips(verify, result) ? (
          <div className="flex flex-col gap-1.5 border-t border-[#FECACA] bg-[#FEF2F2] px-4 pt-3 pb-3.5">
            <span className="text-[13px] font-semibold text-[#111827]">Things to check</span>
            <ul className="m-0 flex list-disc flex-col gap-1 py-0 pr-0 pl-[18px] text-[13px] leading-[19px] text-[#374151]">
              <li>Make sure your changes are published, not just saved as a draft.</li>
              <li>If you use a caching plugin or CDN, clear the cache and check again.</li>
              <li>Check that a cookie banner isn’t blocking the code until visitors accept.</li>
            </ul>
          </div>
        ) : null}
      </section>
    </>
  );
}

function Connector() {
  return (
    <span
      aria-hidden="true"
      className="absolute top-[30px] -bottom-3.5 left-3 w-0.5 rounded-sm bg-[#F3F4F6]"
    />
  );
}

function StepNum({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="relative z-[1] inline-flex size-[26px] flex-[0_0_26px] items-center justify-center rounded-full border-[1.5px] border-[#D1D5DB] bg-white text-[13px] font-semibold text-[#374151]"
    >
      {n}
    </span>
  );
}

interface IconProps {
  size: number;
  width: number;
}

function CheckIcon({ size, width }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon({ size, width }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function Spinner({ size, width }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      aria-hidden="true"
      className="animate-[spin_.8s_linear_infinite] motion-reduce:animate-none"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  );
}

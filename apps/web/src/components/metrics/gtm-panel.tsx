"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CardTitle, EmptyCard, FormField, Section, SelectInput, Spinner } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import type { MetricRow } from "@/lib/view-models";
import { getMetricLastReceivedAction } from "@/server/actions/metric.actions";

const POLL_MS = 2_000;
const WAIT_MS = 60_000;

type TestState =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "ok" }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

/**
 * The GTM tag code. Uses the queue PUSH form, not `routely.track(…)`: GTM may fire the tag before
 * the SDK has loaded, and `push` on a plain array works at any moment — the SDK replays it.
 */
export function gtmTagCode(key: string): string {
  // Event keys are validated as /^[a-z][a-z0-9_]*$/, so they need no escaping inside quotes.
  return `<script>(window.routely = window.routely || []).push(['track', '${key}']);</script>`;
}

/**
 * "Send conversions with Google Tag Manager" (DESIGN.md 2.7 GTM). "Send test event" is REAL:
 * Routely cannot fire the customer's GTM tag itself, so it waits — polling the metric's last
 * received time — while the customer triggers the tag in GTM Preview, and reports success only
 * when a genuinely new event arrives.
 */
export function GtmPanel({
  projectId,
  metrics,
  selectedId,
}: {
  projectId: string;
  /** Custom-event metrics only. */
  metrics: MetricRow[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const metric = metrics.find((m) => m.id === selectedId) ?? metrics[0] ?? null;
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const timers = useRef<{
    poll?: ReturnType<typeof setTimeout>;
    copy?: ReturnType<typeof setTimeout>;
  }>({});
  const run = useRef(0);

  useEffect(() => {
    const t = timers.current;
    return () => {
      run.current += 1;
      clearTimeout(t.poll);
      clearTimeout(t.copy);
    };
  }, []);

  if (!metric) {
    return (
      <EmptyCard
        title="No custom events yet"
        body="Create a custom event metric first, then send it from Google Tag Manager."
        actions={
          <Button onClick={() => router.push(routes.project(projectId).metrics("metrics"))}>
            Go to metrics
          </Button>
        }
      />
    );
  }

  const code = gtmTagCode(metric.key);

  function selectMetric(id: string) {
    run.current += 1;
    clearTimeout(timers.current.poll);
    setTest({ kind: "idle" });
    router.replace(routes.project(projectId).metrics("gtm", { metric: id }), { scroll: false });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timers.current.copy);
      timers.current.copy = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard denied: the code stays selectable in the block. */
    }
  }

  async function startTest() {
    if (!metric || test.kind === "waiting") return;
    const id = ++run.current;
    setTest({ kind: "waiting" });

    const first = await getMetricLastReceivedAction({ projectId, metricId: metric.id });
    if (id !== run.current) return;
    if (first.status === "error") {
      setTest({ kind: "error", message: first.message });
      return;
    }
    const baseline = first.data.lastReceivedAt ? Date.parse(first.data.lastReceivedAt) : 0;
    const deadline = Date.now() + WAIT_MS;

    const poll = async () => {
      if (id !== run.current) return;
      const result = await getMetricLastReceivedAction({ projectId, metricId: metric.id });
      if (id !== run.current) return;
      if (result.status === "success" && result.data.lastReceivedAt) {
        if (Date.parse(result.data.lastReceivedAt) > baseline) {
          setTest({ kind: "ok" });
          router.refresh();
          return;
        }
      }
      if (Date.now() >= deadline) {
        setTest({ kind: "timeout" });
        return;
      }
      timers.current.poll = setTimeout(poll, POLL_MS);
    };
    timers.current.poll = setTimeout(poll, POLL_MS);
  }

  return (
    <Section padded className="gap-4">
      <div>
        <CardTitle size={15.5}>Send conversions with Google Tag Manager</CardTitle>
        <p className="mt-1 text-[13px] text-ink-3">
          GTM detects the action on your site and passes it to Routely, which attributes it to the
          visitor’s assigned variant.
        </p>
      </div>

      <FormField label="Metric" htmlFor="gtm-metric" className="max-w-[380px]">
        <SelectInput
          id="gtm-metric"
          inputSize="md"
          value={metric.id}
          onChange={(e) => selectMetric(e.target.value)}
        >
          {metrics.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.key})
            </option>
          ))}
        </SelectInput>
      </FormField>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3">
        <StepTile n="01" title="Create a tag">
          In GTM: Tags → New → Custom HTML. Paste the code below.
        </StepTile>
        <StepTile n="02" title="Attach your trigger">
          Use the trigger that fires on {metric.name}, e.g. the confirmation page or a dataLayer
          event.
        </StepTile>
        <StepTile n="03" title="Publish & test">
          Publish the container, then send a test event below to confirm Routely receives it.
        </StepTile>
      </div>

      <div className="flex items-start gap-3 rounded-lg bg-navy px-4 py-3.5">
        <pre className="m-0 min-w-0 flex-1 font-mono text-[12.5px] leading-[1.6] break-all whitespace-pre-wrap text-[#C9D6FF] [font-variant-ligatures:none]">
          {code}
        </pre>
        <button
          type="button"
          onClick={copy}
          className="h-7 shrink-0 cursor-pointer rounded-md border border-white/25 bg-transparent px-2.5 text-xs font-bold text-white outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white/40"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          className="border-brand font-extrabold text-brand hover:text-brand"
          onClick={startTest}
          disabled={test.kind === "waiting"}
        >
          {test.kind === "timeout" || test.kind === "error" ? "Try again" : "Send test event"}
        </Button>
        <TestStatus state={test} metricKey={metric.key} />
      </div>
    </Section>
  );
}

function TestStatus({ state, metricKey }: { state: TestState; metricKey: string }) {
  switch (state.kind) {
    case "idle":
      return <span className="text-[13px] text-ink-3">Listening for {metricKey} events…</span>;
    case "waiting":
      return (
        <span
          className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-brand"
          role="status"
        >
          <Spinner size={14} />
          Waiting for {metricKey}…
          <span className="font-semibold text-ink-3">
            Fire the tag now — use GTM Preview, or trigger it on your site.
          </span>
        </span>
      );
    case "ok":
      return (
        <span
          role="status"
          className="rounded-[20px] bg-[#E6F5EE] px-2.5 py-1 text-[13px] font-extrabold text-success-text"
        >
          ✓ Received {metricKey} · just now
        </span>
      );
    case "timeout":
      return (
        <span role="status" className="text-[13px] font-semibold text-danger-text">
          No {metricKey} event arrived in 60 seconds. Check the tag fired in GTM Preview and that
          the Routely snippet is on that page, then try again.
        </span>
      );
    case "error":
      return (
        <span role="alert" className="text-[13px] font-semibold text-danger-text">
          {state.message}
        </span>
      );
  }
}

function StepTile({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-divider p-3.5">
      <div className="font-heading text-xl font-semibold text-coral">{n}</div>
      <div className="mt-1 font-extrabold">{title}</div>
      <div className="mt-0.5 text-[13px] text-ink-3">{children}</div>
    </div>
  );
}

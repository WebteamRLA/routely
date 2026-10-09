"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PreviewModal } from "@/components/editor/preview-modal";
import { previewLink } from "@/components/editor/preview-link";
import { VisualEditor } from "@/components/editor/visual-editor";
import { InstallModal } from "@/components/tracking/install-modal";
import type { InstallInfo } from "@/components/tracking/types";
import {
  WIZARD_STEPS,
  type DraftErrors,
  type ExperimentDraft,
  type WizardStep,
  type WizardStepKey,
} from "@/lib/domain";
import { URL_RE, hostOf } from "@/lib/domain-normalize";
import { qaChecks, readiness, resolveGoal, type QaCheck, type ReadinessItem } from "@/lib/qa";
import { routes } from "@/lib/routes";
import {
  ERROR_GROUPS,
  groupsOf,
  hasErrors,
  leaveBasics,
  removeArm,
  stepHasErrors,
  validateDraft,
} from "@/lib/validate-draft";
import type { MetricRow } from "@/lib/view-models";
import { cn } from "@/lib/utils";
import { launchExperimentAction, saveDraftAction } from "@/server/actions/experiment.actions";
import { checkUrlAction } from "@/server/actions/url-check.actions";

import { DesktopStepper, MobileStepper, SummaryRail } from "./chrome";
import { clearStored, readStored, storageKey, writeStored } from "./draft-storage";
import { LaunchModal, type LaunchState } from "./launch-modal";
import { LeaveModals, type LeaveModal } from "./leave-modals";
import { StepGoals } from "./step-goals";
import { StepReview } from "./step-review";
import { StepSetup } from "./step-setup";
import { type RuleShow, StepTargeting } from "./step-targeting";
import { StepTraffic } from "./step-traffic";
import { StepType } from "./step-type";
import {
  LEAVE_REQUEST_EVENT,
  type LeaveRequestDetail,
  type ShowErr,
  type UrlCheckEntry,
  type WizardProject,
  type WizardStart,
} from "./types";

const STEP_KEYS: WizardStep[] = WIZARD_STEPS.map(([k]) => k);
const REVIEW = STEP_KEYS.length - 1;

/** The fields each group owns, to drop a server error once the customer edits them. */
function stepSlice(d: ExperimentDraft, group: WizardStepKey): string {
  switch (group) {
    case "basics":
      return JSON.stringify([d.name, d.url, d.hypothesis]);
    case "variants":
      return JSON.stringify([d.type, d.arms.map((a) => [a.url, a.changes])]);
    case "traffic":
      return JSON.stringify([d.arms.map((a) => a.weight), d.coverage]);
    case "targeting":
      return JSON.stringify(d.targeting);
    case "goal":
      return JSON.stringify([d.goalMode, d.goal, d.convUrl, d.convMatch, d.secondary, d.counting]);
    default:
      return "";
  }
}

/**
 * `{"variants.v1": ["…"]}` → `{ variants: { v1: "…" } }` (shown on Setup); unknown groups go to
 * Review's list via "basics".
 */
function toDraftErrors(fieldErrors: Record<string, string[]> | undefined): DraftErrors {
  const out: DraftErrors = {};
  for (const [k, msgs] of Object.entries(fieldErrors ?? {})) {
    const dot = k.indexOf(".");
    const group = (dot > 0 ? k.slice(0, dot) : "") as WizardStepKey;
    const field = dot > 0 ? k.slice(dot + 1) : k;
    const g: WizardStepKey = ERROR_GROUPS.includes(group) ? group : "basics";
    if (msgs?.[0]) (out[g] ??= {})[field] = msgs[0];
  }
  return out;
}

/** Reveals the errors of every field group a step shows (Setup: basics and variants). */
function revealStep(s: ShowErr, step: WizardStep): ShowErr {
  const n = { ...s };
  for (const g of groupsOf(step)) n[g] = true;
  return n;
}

function mergeErrors(a: DraftErrors, b: DraftErrors): DraftErrors {
  const out: DraftErrors = {};
  for (const k of ERROR_GROUPS) {
    const merged = { ...(a[k] ?? {}), ...(b[k] ?? {}) };
    if (Object.keys(merged).length) out[k] = merged;
  }
  return out;
}

declare global {
  interface Window {
    __rlWizardMounted?: boolean;
  }
}

/**
 * True when this document was loaded by reloading the page now showing. A copy left behind by a
 * hard navigation away (typed URL, leaving after the unload prompt) must not be restored into a
 * later, unrelated "New A/B test" — it would override the requested type and start over the
 * stale draft.
 */
function reloadedHere(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    if (!nav || nav.type !== "reload") return false;
    return new URL(nav.name).pathname === window.location.pathname;
  } catch {
    return false;
  }
}

function initialState(project: WizardProject, start: WizardStart) {
  const key = storageKey(project.id, start.mode === "edit" ? start.draft.id : null);
  // Restore only on the first wizard mount of this document — i.e. after a refresh — never when
  // the wizard is re-entered by client-side navigation.
  const stored =
    typeof window !== "undefined" && !window.__rlWizardMounted && reloadedHere()
      ? readStored(key, project.id)
      : null;
  return {
    key,
    // Design v2 dropped secondary goals: the wizard shows none and saves none (a legacy draft's
    // are replaced on its next save, as the prototype's save does).
    draft: { ...(stored?.draft ?? start.draft), secondary: [] },
    step: Math.max(0, Math.min(stored?.step ?? start.step, REVIEW)),
    maxStep: Math.min(
      REVIEW,
      Math.max(stored?.maxStep ?? start.maxStep, stored?.step ?? start.step),
    ),
    dirty: stored?.dirty ?? false,
    lastUrl: stored ? stored.lastUrl : start.mode === "edit" ? start.draft.url : null,
  };
}

export interface WizardProps {
  project: WizardProject;
  install: InstallInfo;
  metrics: MetricRow[];
  start: WizardStart;
}

/**
 * The create/edit wizard for both experiment types — design v2's six steps: Type, Setup (with
 * the variants), Traffic, Targeting, Goals, Review & launch.
 */
export function Wizard({ project, install, metrics: initialMetrics, start }: WizardProps) {
  const router = useRouter();
  const [init] = useState(() => initialState(project, start));
  const key = init.key;

  const [draft, setDraft] = useState<ExperimentDraft>(init.draft);
  // Every write goes through `update`/`next`/`saveDraft`, which set this before `setDraft`, so
  // async handlers (save, launch, QA) always see the latest draft.
  const draftRef = useRef(draft);
  const [step, setStep] = useState(init.step);
  const [maxStep, setMaxStep] = useState(init.maxStep);
  const [dirty, setDirty] = useState(init.dirty);
  const [lastUrl, setLastUrl] = useState<string | null>(init.lastUrl);
  // Mirrors `lastUrl` for the async save/launch handlers.
  const lastUrlRef = useRef(init.lastUrl);
  const [showErr, setShowErr] = useState<ShowErr>({});
  const [serverErrors, setServerErrors] = useState<DraftErrors>({});
  const [urlChecks, setUrlChecks] = useState<Record<string, UrlCheckEntry>>({});
  const [qa, setQa] = useState({ running: false, ran: false });
  const qaToken = useRef(0);
  const metrics = initialMetrics;
  const [ruleShow, setRuleShow] = useState<RuleShow>({});
  const [editorArm, setEditorArm] = useState<number | null>(null);
  // The arm whose editor waits for the snippet to be verified (the design's `pendingEd`).
  const [pendingEd, setPendingEd] = useState<number | null>(null);
  const pendingEdRef = useRef<number | null>(null);
  const [previewArm, setPreviewArm] = useState<number | null>(null);
  const [launch, setLaunch] = useState<LaunchState | null>(null);
  const [modal, setModal] = useState<LeaveModal | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState<number | null>(null);
  const leaving = useRef(false);

  const R = draft.type === "redirect";
  const cur = STEP_KEYS[step]!;

  // ---- persistence, dirty flag, leave guards -------------------------------------------------

  useEffect(() => {
    window.__rlWizardMounted = true;
  }, []);

  useEffect(() => {
    if (leaving.current) return;
    writeStored(key, { v: 2, draft, step, maxStep, dirty, lastUrl });
  }, [key, draft, step, maxStep, dirty, lastUrl]);

  // Leaving the wizard by client-side navigation drops the stored copy; a refresh never unmounts.
  useEffect(() => () => clearStored(key), [key]);

  useEffect(() => {
    if (dirty) document.body.dataset.wizardDirty = "1";
    else delete document.body.dataset.wizardDirty;
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      delete document.body.dataset.wizardDirty;
    };
  }, [dirty]);

  useEffect(() => {
    const onLeave = (e: Event) => {
      const detail = (e as CustomEvent<LeaveRequestDetail>).detail;
      if (!detail || typeof detail.proceed !== "function") return;
      e.preventDefault();
      setModal(
        detail.kind === "logout"
          ? { kind: "logout", proceed: detail.proceed }
          : { kind: "switch", proceed: detail.proceed, to: detail.targetName },
      );
    };
    window.addEventListener(LEAVE_REQUEST_EVENT, onLeave);
    return () => window.removeEventListener(LEAVE_REQUEST_EVENT, onLeave);
  }, []);

  // Keep ?step= in the address bar in sync, without a server round trip. The state must be
  // `null`: Next treats a state carrying its own `__NA` marker as an internal call and skips
  // syncing its router, which then puts the stale URL back after the next Server Action.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("step") === cur) return;
      u.searchParams.set("step", cur);
      window.history.replaceState(null, "", u.pathname + u.search);
    } catch {
      // ignore
    }
  }, [cur]);

  // ---- draft updates -------------------------------------------------------------------------

  const update = useCallback((fn: (d: ExperimentDraft) => ExperimentDraft) => {
    const prev = draftRef.current;
    const next = fn(prev);
    if (next === prev) return;
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    setServerErrors((se) => {
      const steps = Object.keys(se) as WizardStepKey[];
      if (!steps.length) return se;
      const out: DraftErrors = { ...se };
      let changed = false;
      for (const s of steps) {
        if (stepSlice(prev, s) !== stepSlice(next, s)) {
          delete out[s];
          changed = true;
        }
      }
      return changed ? out : se;
    });
  }, []);

  const clientErrors = useMemo(() => validateDraft(draft), [draft]);
  const errors = useMemo(
    () => mergeErrors(clientErrors, serverErrors),
    [clientErrors, serverErrors],
  );
  const err = useCallback(
    (s: WizardStepKey, k: string) => (showErr[s] ? (errors[s]?.[k] ?? "") : ""),
    [showErr, errors],
  );

  // ---- URL checks + QA -----------------------------------------------------------------------

  const fetchCheck = useCallback(
    async (url: string): Promise<UrlCheckEntry> => {
      try {
        const res = await checkUrlAction({ projectId: project.id, url });
        if (res.status === "success") return { pending: false, result: res.data };
        return { pending: false, result: null, error: res.message };
      } catch {
        return { pending: false, result: null, error: "We couldn’t check this URL. Try again." };
      }
    },
    [project.id],
  );

  const checkUrl = useCallback(
    (raw: string) => {
      const url = raw.trim();
      if (!URL_RE.test(url)) return;
      setUrlChecks((m) => ({ ...m, [url]: { pending: true } }));
      void fetchCheck(url).then((entry) => setUrlChecks((m) => ({ ...m, [url]: entry })));
    },
    [fetchCheck],
  );
  const urlCheck = useCallback((raw: string) => urlChecks[raw.trim()], [urlChecks]);

  const runQa = useCallback(async () => {
    const d = draftRef.current;
    const urls = [
      ...new Set(
        [d.url, ...(d.type === "redirect" ? d.arms.slice(1).map((a) => a.url) : [])]
          .map((u) => u.trim())
          .filter((u) => URL_RE.test(u)),
      ),
    ];
    const token = ++qaToken.current;
    setQa({ running: true, ran: false });
    setUrlChecks((m) => {
      const n = { ...m };
      for (const u of urls) n[u] = { pending: true };
      return n;
    });
    await Promise.all(
      urls.map(async (u) => {
        const entry = await fetchCheck(u);
        if (token === qaToken.current) setUrlChecks((m) => ({ ...m, [u]: entry }));
      }),
    );
    if (token === qaToken.current) setQa({ running: false, ran: true });
  }, [fetchCheck]);

  const qaUrlChecks = useMemo(() => {
    const out: Record<string, { ok: boolean; status?: number }> = {};
    for (const [u, e] of Object.entries(urlChecks)) {
      if (!e.pending && e.result)
        out[u] = { ok: e.result.ok, status: e.result.status ?? undefined };
    }
    return out;
  }, [urlChecks]);

  const checks = useMemo(
    () =>
      qaChecks(draft, {
        trackingInstalled: install.installed,
        projectDomains: project.domains,
        metrics,
        urlChecks: qaUrlChecks,
      }),
    [draft, install.installed, project.domains, metrics, qaUrlChecks],
  );
  const rd = useMemo(
    () =>
      readiness(draft, errors, qa.ran ? checks : null, {
        trackingInstalled: install.installed,
        metrics,
      }),
    [draft, errors, qa.ran, checks, install.installed, metrics],
  );
  const rowPending = useCallback(
    (c: QaCheck) => {
      if (!qa.running) return false;
      const pending = (u: string) => urlChecks[u.trim()]?.pending === true;
      if (c.id === "control") return pending(draft.url);
      if (c.id === "variants") return draft.arms.slice(1).some((a) => pending(a.url));
      return false;
    },
    [qa.running, urlChecks, draft],
  );

  const goal = resolveGoal(draft, metrics);

  // ---- navigation ----------------------------------------------------------------------------

  const scrollTop = () => {
    window.scrollTo({ top: 0 });
    document.querySelector("main")?.scrollTo?.({ top: 0 });
  };

  /**
   * What the prototype does when Continue leaves Setup (`leaveBasics`): control's arm URL and
   * the page rule follow the experiment URL while the rule is still the auto-filled one. Run on
   * every way out of Setup and before saving or launching — design v2 hides the page rule, so
   * it must never be left behind on an old URL.
   */
  const syncSetup = useCallback((): ExperimentDraft => {
    const d = leaveBasics(draftRef.current, lastUrlRef.current);
    if (JSON.stringify(d) !== JSON.stringify(draftRef.current)) {
      draftRef.current = d;
      setDraft(d);
    }
    lastUrlRef.current = d.url;
    setLastUrl(d.url);
    return d;
  }, []);

  const goStep = useCallback(
    (i: number, reveal = false) => {
      const target = Math.max(0, Math.min(i, REVIEW));
      if (STEP_KEYS[step] === "basics" && target !== step) syncSetup();
      setStep(target);
      if (reveal && target < REVIEW) setShowErr((s) => revealStep(s, STEP_KEYS[target]!));
      if (target === REVIEW) void runQa();
      scrollTop();
    },
    [runQa, step, syncSetup],
  );

  const missingChanges = !R
    ? draft.arms.filter((a, i) => i > 0 && !a.changes.length).map((a) => a.name)
    : [];
  // An A/B variant without changes blocks Continue on Setup (design v2 `vBlock`).
  const variantsBlocked = cur === "basics" && !R && hasErrors(clientErrors, "variants");

  const next = () => {
    if (variantsBlocked) {
      setShowErr((s) => ({ ...s, variants: true }));
      return;
    }
    if (cur !== "review" && stepHasErrors(errors, cur)) {
      setShowErr((s) => revealStep(s, cur));
      toast("Fix the highlighted fields to continue");
      return;
    }
    const n = step + 1;
    setMaxStep((m) => Math.max(m, n));
    goStep(n);
  };

  // ---- save / exit / leave -------------------------------------------------------------------

  const saveDraft = useCallback(async (): Promise<string | null> => {
    const snapshot = syncSetup();
    setSaving(true);
    try {
      const res = await saveDraftAction(snapshot);
      if (res.status !== "success") {
        toast(res.message);
        return null;
      }
      const id = res.data.id;
      const now = { ...draftRef.current, id };
      draftRef.current = now;
      setDraft(now);
      const { id: _a, ...a } = snapshot;
      const { id: _b, ...b } = now;
      setDirty(JSON.stringify(a) !== JSON.stringify(b));
      toast("Draft saved");
      return id;
    } catch {
      toast("Couldn’t save the draft. Check your connection and try again.");
      return null;
    } finally {
      setSaving(false);
    }
  }, [syncSetup]);

  const leaveTo = useCallback(
    (href: string) => {
      leaving.current = true;
      clearStored(key);
      setDirty(false);
      router.push(href);
    },
    [key, router],
  );

  const listHref = routes.project(project.id).experiments();
  const exit = () => (dirty ? setModal({ kind: "exit" }) : leaveTo(listHref));

  const onModalDiscard = () => {
    const m = modal;
    setModal(null);
    if (!m) return;
    if (m.kind === "exit") return leaveTo(listHref);
    leaving.current = true;
    clearStored(key);
    setDirty(false);
    delete document.body.dataset.wizardDirty;
    m.proceed();
  };
  const onModalSave = async () => {
    const m = modal;
    if (!m) return;
    const id = await saveDraft();
    if (!id) return;
    setModal(null);
    if (m.kind === "exit") return leaveTo(listHref);
    leaving.current = true;
    clearStored(key);
    setDirty(false);
    delete document.body.dataset.wizardDirty;
    m.proceed();
  };

  // ---- review actions ------------------------------------------------------------------------

  const onFix = (item: ReadinessItem) => {
    if (item.stepIndex < 0) return setInstallOpen(true);
    goStep(item.stepIndex, item.action === "Fix");
  };

  // ---- visual editor, gated on the snippet (design v2 `pendingEd`) -----------------------------

  const setPending = (arm: number | null) => {
    pendingEdRef.current = arm;
    setPendingEd(arm);
  };

  /**
   * Editing a variant needs the Routely snippet on the page, so without verified tracking the
   * install modal opens instead (in its editor mode) and the editor follows once the snippet is
   * verified. Control's "View original" only previews, so it is never gated.
   */
  const openEditor = (arm: number) => {
    if (arm > 0 && !install.installed) {
      setPending(arm);
      setInstallOpen(true);
      return;
    }
    setEditorArm(arm);
  };

  const closeInstall = () => {
    setInstallOpen(false);
    setPending(null);
    router.refresh();
    if (STEP_KEYS[step] === "review") window.setTimeout(() => void runQa(), 80);
  };

  /** The snippet was verified: an editor waiting on it opens now. */
  const onInstallVerified = () => {
    const arm = pendingEdRef.current;
    if (arm === null) return;
    setPending(null);
    setInstallOpen(false);
    router.refresh();
    setEditorArm(arm);
    toast("Routely verified · opening the visual editor");
  };

  const onCopyLink = async (arm: number) => {
    let id = draftRef.current.id;
    if (!id || dirty) {
      setCopying(arm);
      id = await saveDraft();
      setCopying(null);
      if (!id) return;
    }
    const link = previewLink(draftRef.current.url, id, arm);
    try {
      await navigator.clipboard.writeText(link);
      toast("Copied to clipboard");
    } catch {
      toast(link);
    }
  };

  const openLaunch = () => {
    if (!rd.canLaunch) {
      toast(
        rd.trackingMissing
          ? "Install project tracking before launching"
          : rd.blockingCount
            ? "Fix the blocking issues before launching"
            : "Wait for the pre-launch checks to finish",
      );
      return;
    }
    setLaunch({ state: "confirm", ok: false, warns: rd.warnings.map((w) => w.text) });
  };

  const doLaunch = async () => {
    if (!launch || launch.state !== "confirm" || !launch.ok) return;
    setLaunch({ ...launch, state: "launching" });
    try {
      const res = await launchExperimentAction(syncSetup());
      if (res.status === "success") {
        leaving.current = true;
        clearStored(key);
        setDirty(false);
        setLaunch({ state: "done", id: res.data.id, name: draftRef.current.name });
        return;
      }
      const fe = toDraftErrors(res.fieldErrors);
      if (Object.keys(fe).length) {
        setLaunch(null);
        setServerErrors(fe);
        setShowErr((s) => {
          const n = { ...s };
          for (const k of Object.keys(fe)) {
            const g = k as WizardStepKey;
            n[g] = true;
            // Setup shows both of its groups' errors together.
            if (g === "basics" || g === "variants") n.basics = n.variants = true;
          }
          return n;
        });
      } else {
        setLaunch({ ...launch, state: "confirm" });
      }
      toast(res.message);
    } catch {
      setLaunch({ ...launch, state: "confirm" });
      toast("Couldn’t launch. Check your connection and try again.");
    }
  };

  const viewLaunched = () => {
    if (launch?.state === "done") {
      router.push(routes.project(project.id).experiment(launch.id));
    }
  };

  // ---- render --------------------------------------------------------------------------------

  const title = draft.id
    ? `Edit: ${draft.name || "Untitled"}`
    : R
      ? "New split URL test"
      : "New A/B test";
  const stepProps = { draft, update, err, showErr };
  const isReview = cur === "review";
  const launchHint = rd.trackingMissing
    ? "Install project tracking to enable launch"
    : qa.running || !qa.ran
      ? "Waiting for pre-launch checks to finish"
      : rd.blockingCount
        ? `Fix ${rd.blockingCount} blocking issue${rd.blockingCount === 1 ? "" : "s"} to enable launch`
        : rd.warnings.length
          ? `You can launch with ${rd.warnings.length} warning${rd.warnings.length === 1 ? "" : "s"}`
          : "Everything is ready";
  const hintColor =
    rd.blockingCount && qa.ran
      ? "text-danger-text"
      : rd.warnings.length && qa.ran
        ? "text-[#94600A]"
        : qa.ran
          ? "text-success-text"
          : "text-ink-3";

  return (
    <div className="mx-auto flex w-full max-w-[1680px] animate-rl-in flex-col gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={exit}
            className="h-[34px] shrink-0 cursor-pointer rounded-md border border-input bg-white px-3 text-[13px] font-bold hover:bg-muted"
          >
            ← Exit
          </button>
          <div className="min-w-0">
            <div className="text-xs font-extrabold tracking-[0.08em] text-coral">
              CREATE EXPERIMENT
            </div>
            <h1 className="m-0 truncate font-heading text-xl font-semibold">{title}</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void saveDraft()}
          disabled={saving}
          className="h-9 cursor-pointer rounded-md border border-input bg-white px-3.5 text-[13px] font-bold hover:bg-muted disabled:cursor-wait disabled:opacity-70"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
      </div>

      <DesktopStepper
        step={step}
        maxStep={maxStep}
        bad={(i) => groupsOf(STEP_KEYS[i]!).some((g) => !!showErr[g] && hasErrors(errors, g))}
        onGo={(i) => goStep(i)}
      />
      <MobileStepper step={step} />

      <div className="flex items-start gap-5">
        <div
          className={cn("mx-auto flex min-w-0 flex-1 flex-col gap-4", isReview && "max-w-[880px]")}
        >
          {cur === "type" ? <StepType draft={draft} update={update} /> : null}
          {cur === "basics" ? (
            <StepSetup
              {...stepProps}
              urlCheck={urlCheck}
              onCheckUrl={checkUrl}
              onRemoveArm={(i) => {
                update((d) => removeArm(d, i));
                toast("Variant removed · traffic re-split evenly");
              }}
              onOpenEditor={openEditor}
              installed={install.installed}
            />
          ) : null}
          {cur === "traffic" ? <StepTraffic {...stepProps} /> : null}
          {cur === "targeting" ? (
            <StepTargeting
              {...stepProps}
              show={ruleShow}
              setShow={(k, on) => setRuleShow((s) => ({ ...s, [k]: on }))}
            />
          ) : null}
          {cur === "goal" ? <StepGoals {...stepProps} metrics={metrics} /> : null}
          {isReview ? (
            <StepReview
              draft={draft}
              readiness={rd}
              checks={checks}
              qa={qa}
              rowPending={rowPending}
              goal={goal}
              installed={install.installed}
              primaryDomain={project.domain}
              onGoStep={(i) => goStep(i)}
              onFix={onFix}
              onOpenInstall={() => setInstallOpen(true)}
              onRunQa={() => void runQa()}
              onPreview={(i) => setPreviewArm(i)}
              onCopyLink={(i) => void onCopyLink(i)}
              copying={copying}
            />
          ) : null}

          <div className="sticky bottom-0 z-[5] flex flex-wrap items-center gap-2.5 bg-[linear-gradient(180deg,rgba(245,246,249,0)_0%,#F5F6F9_22%)] pt-3.5 pb-6">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => goStep(step - 1)}
                className="h-[42px] cursor-pointer rounded-md border border-input bg-white px-4 font-bold hover:bg-muted"
              >
                ← Back
              </button>
            ) : null}
            <div className="flex-1" />
            {!isReview ? (
              <>
                {variantsBlocked && missingChanges.length ? (
                  <span
                    className={cn(
                      "text-right text-[13px] font-bold",
                      showErr.variants ? "text-danger-text" : "text-ink-3",
                    )}
                  >
                    Add a change to {missingChanges.join(" and ")} to continue
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={next}
                  aria-disabled={variantsBlocked || undefined}
                  className={cn(
                    "h-[42px] rounded-md border px-5 font-extrabold",
                    variantsBlocked
                      ? "cursor-not-allowed border-[#C9D2E3] bg-[#C9D2E3] text-ink-3"
                      : "cursor-pointer border-brand bg-brand text-white hover:bg-brand-hover",
                  )}
                >
                  {cur === "goal" ? "Review & launch →" : "Continue →"}
                </button>
              </>
            ) : (
              <>
                <span role="status" className={cn("text-right text-[13px] font-bold", hintColor)}>
                  {launchHint}
                </span>
                <button
                  type="button"
                  onClick={openLaunch}
                  aria-disabled={!rd.canLaunch || undefined}
                  className={cn(
                    "h-11 rounded-md border-0 px-6 text-sm font-extrabold shadow-[0_1px_0_rgba(10,22,51,0.06)]",
                    rd.canLaunch
                      ? "cursor-pointer bg-brand text-white hover:bg-brand-hover"
                      : "cursor-not-allowed bg-[#C9D2E3] text-ink-3",
                  )}
                >
                  Launch experiment
                </button>
              </>
            )}
          </div>
        </div>

        {!isReview ? (
          <SummaryRail
            draft={draft}
            goalName={goal ? goal.name : null}
            showVariantErr={!!showErr.variants}
          />
        ) : null}
      </div>

      <VisualEditor
        open={editorArm !== null}
        arms={draft.arms}
        initialArm={editorArm ?? 1}
        url={draft.url}
        projectName={project.name}
        onChange={(arm, changes) =>
          update((d) => ({
            ...d,
            arms: d.arms.map((a, i) => (i === arm ? { ...a, changes } : a)),
          }))
        }
        onClose={() => setEditorArm(null)}
      />
      <PreviewModal
        open={previewArm !== null}
        onClose={() => setPreviewArm(null)}
        type={draft.type}
        url={draft.url}
        arms={draft.arms}
        initialArm={previewArm ?? 0}
        projectName={project.name}
        experimentId={draft.id && !dirty ? draft.id : undefined}
      />
      <LaunchModal
        launch={launch}
        draft={draft}
        goal={goal}
        onToggle={() => setLaunch((l) => (l && l.state === "confirm" ? { ...l, ok: !l.ok } : l))}
        onLaunch={() => void doLaunch()}
        onClose={() => {
          if (launch?.state === "done") viewLaunched();
          else if (launch?.state !== "launching") setLaunch(null);
        }}
        onView={viewLaunched}
      />
      <LeaveModals
        modal={modal}
        projectName={project.name}
        saving={saving}
        onCancel={() => setModal(null)}
        onDiscard={onModalDiscard}
        onSave={() => void onModalSave()}
      />
      <InstallModal
        open={installOpen}
        onClose={closeInstall}
        onContinue={() => (pendingEdRef.current !== null ? onInstallVerified() : closeInstall())}
        onVerified={onInstallVerified}
        editorHost={
          pendingEd !== null ? hostOf(draft.url.trim()) || project.domain || "your site" : undefined
        }
        install={install}
        projectName={project.name}
        context="wizard"
      />
    </div>
  );
}

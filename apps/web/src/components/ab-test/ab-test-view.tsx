"use client";

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { CheckIcon, ChevronRightIcon, Spinner } from "@/components/rt/icons";
import { ToastHost, useToast } from "@/components/rt/toast";
import { useDraftSync } from "@/components/wizard-draft/use-draft-sync";
import { routes } from "@/lib/routes";
import {
  ELEMENTS,
  armsOf,
  changeCountOf,
  clone,
  draftPatch,
  evenSplit,
  initState,
  liveState,
  rebalance,
  shortUrl,
  trackKey,
  validUrl,
  veFor,
  type AbForm,
  type AbState,
  type AbTestViewName,
  type ElementChange,
  type ElementId,
} from "@/lib/mock/ab-test";
import { type WizardCtx, trackingFromChecks } from "@/lib/wizard-draft";
import { checkTrackingAction, launchExperimentAction } from "@/server/actions/experiment.actions";
import type { VisualChange } from "@/validation/visual-change";

import { ConfirmDialog } from "./dialog";
import { PauseIcon, PlayIcon } from "./icons";
import { InstallModal, LaunchDialog } from "./install-modal";
import { LiveVisualEditor } from "./live-editor/live-visual-editor";
import { derive } from "./model";
import { Results, Success } from "./results";
import { cls } from "./ui";
import { VisualEditor, type EditorAct } from "./visual-editor";
import { Wizard, type WizardAct } from "./wizard";
import { cn } from "@/lib/utils";

type Patch = Partial<AbState> | ((s: AbState) => Partial<AbState>);

function reducer(s: AbState, p: Patch): AbState {
  return { ...s, ...(typeof p === "function" ? p(s) : p) };
}

/** A real draft to open (or a new one to create in `ctx.projectId`). */
export interface AbTestLive {
  ctx: WizardCtx;
  form: AbForm;
  step: number;
  savedLabel: string;
  resumeInfo: { title: string; text: string } | null;
}

/** The pages the tracking check covers: the tested page and the goal page. */
function trackedPages(f: AbForm) {
  return [
    { id: "page", url: f.pageUrl },
    { id: "goal", url: f.goalUrl },
  ];
}

/**
 * The A/B test screen: a five-step setup wizard, the visual editor it opens, the tracking check
 * and launch flow, and the live experiment's results — the design's `ABTest` component.
 *
 * One state object with merge-patches, as in the reference's logic class, so each handler below
 * reads like its counterpart there. With `live`, every edit (the visual editor's saved changes
 * included) autosaves to the draft, tracking checks and launch go to the server, and "View
 * results" opens the experiment's page. Without it (the design's `?view=` states), the timed
 * steps are simulated with the reference's delays.
 */
export function AbTestView({ view, live }: { view: AbTestViewName; live?: AbTestLive }) {
  const [s, set] = useReducer(reducer, null, () =>
    live
      ? liveState(live.ctx, live.form, {
          step: live.step,
          savedLabel: live.savedLabel,
          resumeInfo: live.resumeInfo,
        })
      : initState(view),
  );
  const { toast, notify } = useToast();
  const d = useMemo(() => derive(s), [s]);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const isLive = s.ctx.live;

  // The latest state, for the autosave's patch and for async handlers that outlive a render.
  const latest = useRef(s);
  useLayoutEffect(() => {
    latest.current = s;
  });

  const sync = useDraftSync({
    enabled: isLive && !s.ctx.readOnly,
    type: "AB_TEST",
    projectId: s.ctx.projectId,
    initialId: live?.ctx.draftId ?? null,
    initialVariantIds: live?.ctx.draftId ? live.form.variants.map((v) => v.id) : [],
    buildPatch: (idFor) => draftPatch(latest.current.form, latest.current.step, idFor),
    onSaved: (data, pending) =>
      set((cur) => ({
        saving: pending,
        savedLabel: "Draft saved",
        ctx: { ...cur.ctx, draftId: data.id, baseline: data.baseline },
      })),
    onError: (message) => {
      set({ saving: false });
      notify("We couldn’t save your draft", message);
    },
  });

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const later = (name: string, ms: number, fn: () => void) => {
    clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(fn, ms);
  };
  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  // `<main>` is the shell's scroll container, so "scroll to top" scrolls it, not the window.
  const scrollTop = () => {
    const main = rootRef.current?.closest("main");
    if (main) main.scrollTop = 0;
  };

  const setForm = (patch: Partial<AbForm> | ((f: AbForm) => Partial<AbForm>)) => {
    set((cur) => ({
      form: { ...cur.form, ...(typeof patch === "function" ? patch(cur.form) : patch) },
      saving: !cur.ctx.readOnly,
      // A server-only problem (another test on the page) is re-judged at the next launch.
      serverIssues: [],
    }));
    if (isLive) sync.schedule();
    else later("save", 700, () => set({ saving: false, savedLabel: "Draft saved" }));
  };

  /** A tracking result as state, opening the install flow when the snippet is missing on step 5
   * — what the reference does after its first check. */
  const trackingPatch = (
    cur: AbState,
    mapped: ReturnType<typeof trackingFromChecks> | null,
    key: string,
  ): Partial<AbState> => {
    const attempts = (cur.tracking.attempts || 0) + 1;
    if (!mapped || mapped.status === "error") {
      return { tracking: { status: "error", results: {}, key, attempts } };
    }
    const patch: Partial<AbState> = {
      tracking: { status: "done", results: mapped.results, details: mapped.details, key, attempts },
    };
    const missing = Object.values(mapped.results).some((r) => r === "missing");
    if (missing && cur.step === 5 && cur.phase === "edit" && cur.modal !== "install") {
      Object.assign(patch, { modal: "install", instStep: 1, verify: "idle", copied: false });
    }
    return patch;
  };

  /** Checks the snippet on the tested page and the goal page. `force` re-checks recent passes. */
  const checkLive = async (force: boolean) => {
    const key = trackKey(latest.current.form);
    const id = await sync.flush();
    const res = id ? await checkTrackingAction(id, { force }) : null;
    const mapped = res?.ok
      ? trackingFromChecks(trackedPages(latest.current.form), res.data.checks)
      : null;
    set((cur) => trackingPatch(cur, mapped, key));
    if (res && !res.ok && res.code !== "INTERNAL")
      notify("We couldn’t check your pages", res.message);
    if (mapped?.status !== "done") return false;
    // Nothing checked (no URLs yet) isn't a verified install.
    const results = Object.values(mapped.results);
    return results.length > 0 && results.every((r) => r === "ok");
  };

  const runCheck = (force = false) => {
    // A Viewer can't run checks (each is an outbound fetch on the project's behalf).
    if (isLive && s.ctx.readOnly) return;
    set((cur) => ({ tracking: { ...cur.tracking, status: "checking" } }));
    if (isLive) {
      void checkLive(force);
      return;
    }
    later("check", 1500, () =>
      set((cur) => {
        const attempts = (cur.tracking.attempts || 0) + 1;
        // The first check misses the goal page so the install flow is reachable; later ones pass.
        const results =
          attempts === 1
            ? ({ page: "ok", goal: "missing" } as const)
            : ({ page: "ok", goal: "ok" } as const);
        const patch: Partial<AbState> = {
          tracking: { status: "done", results, key: trackKey(cur.form), attempts },
        };
        if (results.goal === "missing" && cur.step === 5 && cur.phase === "edit") {
          Object.assign(patch, { modal: "install", instStep: 1, verify: "idle", copied: false });
        }
        return patch;
      }),
    );
  };

  // A draft reopened on the review step has never been checked in this visit: check it, as
  // entering the step would have.
  const reopenedOnReview = useRef(isLive && s.step === 5 && !s.ctx.readOnly);
  useEffect(() => {
    if (!reopenedOnReview.current) return;
    // Flipped when it fires, not before: StrictMode's mount–unmount–mount clears the first timer.
    const timer = setTimeout(() => {
      reopenedOnReview.current = false;
      runCheck();
    }, 0);
    return () => clearTimeout(timer);
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goStep = (n: number) => {
    set((cur) => ({ step: n, visited: Math.max(cur.visited || 1, n) }));
    scrollTop();
    // The step is part of the draft: a reopened draft resumes where it was left.
    if (isLive) sync.schedule();
    if (n === 5) {
      const t = s.tracking;
      if (t.status === "idle" || (t.status === "done" && t.key !== trackKey(s.form))) runCheck();
    }
  };

  const removeVariant = (id: string, name: string) => {
    const remaining = s.form.variants.filter((x) => x.id !== id);
    setForm({
      variants: remaining,
      split: evenSplit(["control", ...remaining.map((x) => x.id)]),
    });
    notify(
      name + " removed",
      "Traffic is now split evenly between " + (remaining.length + 1) + " versions.",
    );
  };

  // The editor loads the tested page, so it needs a valid URL to open.
  const openEditor = (target: string) => {
    if (!validUrl(s.form.pageUrl)) return;
    set({ ve: veFor(target, "desktop", s.form) });
  };

  const act: WizardAct = {
    setForm,
    goStep,
    next: () => {
      const ce = s.step < 5 ? d.errs[s.step as 1 | 2 | 3 | 4] : null;
      if (ce && ce.count > 0) {
        set({ attempted: { ...s.attempted, [s.step]: true } });
        return;
      }
      goStep(s.step + 1);
    },
    back: () => {
      if (s.step > 1) goStep(s.step - 1);
    },
    fix: (n: number) => {
      set({ attempted: { ...s.attempted, [n]: true } });
      goStep(n);
    },
    openEditor,
    addVariant: () => {
      setForm((f) => {
        if (f.variants.length >= 4) return {};
        const used = f.variants.map((x) => x.color);
        const color = [1, 2, 3, 4].find((c) => !used.includes(c)) ?? 1;
        const names = f.variants.map((x) => x.name);
        const letter =
          ["A", "B", "C", "D"].find((l) => !names.includes("Variant " + l)) ??
          String(f.variants.length + 1);
        const vs = [
          ...f.variants,
          { id: "v" + f.nextId, name: "Variant " + letter, color, changes: {} },
        ];
        return {
          variants: vs,
          nextId: f.nextId + 1,
          split: evenSplit(["control", ...vs.map((x) => x.id)]),
        };
      });
    },
    removeVariant: (id: string) => {
      const v = s.form.variants.find((x) => x.id === id);
      if (!v) return;
      const n = changeCountOf(v);
      if (n > 0) {
        set({ rmConfirm: { id, name: v.name, n } });
        return;
      }
      removeVariant(id, v.name);
    },
    applySplit: (id: string, raw: string) => {
      const val = String(raw).replace(/[^\d]/g, "").slice(0, 3);
      setForm((f) => ({
        split:
          val === ""
            ? { ...f.split, [id]: "" }
            : rebalance(
                f.split,
                armsOf(f).map((x) => x.id),
                id,
                parseInt(val, 10),
              ),
      }));
    },
    splitEvenly: () => setForm((f) => ({ split: evenSplit(armsOf(f).map((a) => a.id)) })),
    setInclude: (raw: string) =>
      setForm({ include: String(raw).replace(/[^\d]/g, "").slice(0, 3) }),
    toggleDevice: (k: "desktop" | "mobile" | "tablet") =>
      setForm((f) => ({ devices: { ...f.devices, [k]: !f.devices[k] } })),
    recheck: () => runCheck(true),
    openInstall: () => set({ modal: "install", instStep: 1, verify: "idle", copied: false }),
    saveDraft: () => {
      const done = () => {
        set({ savedLabel: "Draft saved" });
        notify("Draft saved", "You can finish this experiment later from the Experiments page.");
      };
      if (!isLive || s.ctx.readOnly) return done();
      void sync.flush().then((id) => {
        if (id) done();
      });
    },
    launchClick: () => {
      if (!d.allValid || s.tracking.status === "checking") return;
      if (d.missing.length || s.tracking.status === "error") {
        set({ modal: "install", instStep: 1, verify: "idle", copied: false, launchError: false });
        return;
      }
      if (s.tracking.status === "idle" || d.stale) {
        runCheck();
        return;
      }
      set({ modal: "confirm", launchError: false });
    },
    dismissResume: () => set({ resumed: false }),
  };

  // --- Install / launch / pause modals -------------------------------------------------------
  const closeModal = () => {
    if (s.launching) return;
    set({ modal: null });
  };
  const pixelKey = s.ctx.pixelKey;
  const snippet = s.ctx.snippet;
  const copySnippet = () => {
    try {
      void navigator.clipboard?.writeText(snippet).catch(() => {});
    } catch (_err) {
      // Clipboard can be unavailable (insecure origin, permissions); the label still confirms.
    }
    set({ copied: true });
    later("copy", 2000, () => set({ copied: false }));
  };
  const verifyInstall = () => {
    set({ verify: "checking" });
    if (isLive) {
      void checkLive(true).then((ok) => set({ verify: ok ? "success" : "idle" }));
      return;
    }
    later("verify", 1500, () =>
      set((cur) => ({
        verify: "success",
        tracking: {
          status: "done",
          results: { page: "ok", goal: "ok" },
          key: trackKey(cur.form),
          attempts: (cur.tracking.attempts || 0) + 1,
        },
      })),
    );
  };
  const launchLive = async () => {
    const key = trackKey(latest.current.form);
    const id = await sync.flush();
    const res = id ? await launchExperimentAction(id) : null;
    if (res?.ok) {
      // One results page (spec §8 #2): a launched experiment lives at /experiments/[id]. The
      // confirm stays on "Launching…" until it opens; replace, so Back skips the spent wizard.
      router.replace(routes.experiments.detail(res.data.experimentId));
      return;
    }
    if (res?.issues?.length) {
      // Rule failures go back to the step issues, not the "something went wrong" banner.
      const issues = res.issues;
      set((cur) => ({
        launching: false,
        modal: null,
        serverIssues: issues,
        attempted: { ...cur.attempted, ...Object.fromEntries(issues.map((i) => [i.step, true])) },
      }));
      return;
    }
    if (res?.tracking) {
      const mapped = trackingFromChecks(trackedPages(latest.current.form), res.tracking.checks);
      set((cur) => ({
        launching: false,
        modal: null,
        ...trackingPatch({ ...cur, modal: null }, mapped, key),
      }));
      return;
    }
    set({ launching: false, modal: null, launchError: true });
  };

  const confirmLaunch = () => {
    set({ launching: true });
    if (isLive) {
      void launchLive();
      return;
    }
    later("launch", 1500, () => {
      set({ launching: false, modal: null, launchError: false, phase: "success" });
      scrollTop();
    });
  };
  const confirmPause = () => {
    const was = s.paused;
    set({ paused: !was, modal: null });
    notify(
      was ? "Experiment resumed" : "Experiment paused",
      was
        ? "Visitors are seeing your variants again."
        : "Everyone now sees the original page. Your data is kept.",
    );
  };

  // --- Visual editor ---------------------------------------------------------------------------
  const ve = s.ve;
  const veDirty = (st: AbState) =>
    !!st.ve &&
    !!st.form.variants.find((x) => x.id === st.ve!.target) &&
    st.phase === "edit" &&
    JSON.stringify(st.ve.draft || {}) !== JSON.stringify(st.ve.saved || {});
  const setDraft = (id: ElementId, key: keyof ElementChange, value: string) => {
    set((cur) => {
      if (!cur.ve) return {};
      const dr = clone(cur.ve.draft);
      const o: ElementChange = { ...(dr[id] || {}) };
      if (value === ELEMENTS[id][key]) delete o[key];
      else (o as Record<string, string>)[key] = value;
      if (Object.keys(o).length) dr[id] = o;
      else delete dr[id];
      const history = [...(cur.ve.history || []), cur.ve.draft].slice(-40);
      return { ve: { ...cur.ve, draft: dr, history } };
    });
  };
  const removeDraft = (id: ElementId) => {
    set((cur) => {
      if (!cur.ve) return {};
      const dr = clone(cur.ve.draft);
      delete dr[id];
      const history = [...(cur.ve.history || []), cur.ve.draft].slice(-40);
      return { ve: { ...cur.ve, draft: dr, history } };
    });
  };
  const veAct: EditorAct = {
    pick: (id: ElementId) => set((cur) => (cur.ve ? { ve: { ...cur.ve, selected: id } } : {})),
    deselect: () => set((cur) => (cur.ve ? { ve: { ...cur.ve, selected: null } } : {})),
    setDevice: (device: "desktop" | "tablet" | "mobile") =>
      set((cur) => (cur.ve ? { ve: { ...cur.ve, device } } : {})),
    setDraft,
    removeDraft,
    undo: () =>
      set((cur) => {
        if (!cur.ve) return {};
        const h = (cur.ve.history || []).slice();
        if (!h.length) return {};
        const prev = h.pop()!;
        return { ve: { ...cur.ve, draft: prev, history: h } };
      }),
    switchTo: (target: string) => {
      if (!ve || ve.target === target) return;
      if (veDirty(s)) {
        set({ veConfirm: { next: target } });
        return;
      }
      set({ ve: veFor(target, ve.device, s.form) });
    },
    save: () => {
      if (!ve) return;
      const target = s.form.variants.find((x) => x.id === ve.target);
      if (!target) return;
      const dr = clone(ve.draft);
      setForm((f) => ({
        variants: f.variants.map((x) => (x.id === ve.target ? { ...x, changes: dr } : x)),
      }));
      set((cur) => (cur.ve ? { ve: { ...cur.ve, saved: clone(dr) } } : {}));
      const n = Object.keys(dr).length;
      notify(
        "Saved to " + target.name,
        n
          ? n +
              (n === 1 ? " element changed." : " elements changed.") +
              " The original page isn’t affected."
          : target.name + " has no changes yet.",
      );
    },
    exit: () => {
      if (veDirty(s)) {
        set({ veConfirm: { next: null } });
        return;
      }
      set({ ve: null });
    },
  };
  /** The live editor's "Save changes": the variant's change list, stored by the autosave. */
  const saveLive = (variantId: string, changes: VisualChange[]) => {
    const target = s.form.variants.find((x) => x.id === variantId);
    if (!target) return;
    setForm((f) => ({
      variants: f.variants.map((x) => (x.id === variantId ? { ...x, visual: changes } : x)),
    }));
    const n = changes.length;
    notify(
      "Saved to " + target.name,
      n
        ? n +
            (n === 1 ? " element changed." : " elements changed.") +
            " The original page isn’t affected."
        : target.name + " has no changes yet.",
    );
  };
  const confirmDiscard = () => {
    const c = s.veConfirm;
    if (c?.next) set({ ve: veFor(c.next, ve ? ve.device : "desktop", s.form), veConfirm: null });
    else set({ ve: null, veConfirm: null });
  };

  const head = d.head;
  const isEdit = s.phase === "edit";

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-[#6B7280]"
          >
            <Link
              href={routes.experiments.list}
              className="font-medium text-[#4B5563] no-underline hover:text-[#111827] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
            >
              Experiments
            </Link>
            <ChevronRightIcon size={14} className="flex-none text-[#9CA3AF]" />
            <span aria-current="page" className="truncate font-medium text-[#111827]">
              {head.crumb}
            </span>
          </nav>
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-[20px] leading-7 font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] text-[#111827]">
              {head.title}
            </h1>
            <span
              className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold whitespace-nowrap"
              style={{ background: head.badgeBg, color: head.badgeFg }}
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: head.badgeDot }}
              />
              {head.badge}
            </span>
          </div>
          <p className="m-0 text-[14px] leading-[22px] text-[#4B5563]">{head.sub}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 max-[641px]:w-full max-[641px]:[&>a]:flex-auto max-[641px]:[&>button]:flex-auto">
          {isEdit ? (
            <>
              <span
                aria-live="polite"
                className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-[#6B7280]"
              >
                {s.saving ? <Spinner size={14} /> : null}
                {!s.saving && s.savedLabel ? (
                  <CheckIcon size={14} strokeWidth={2.4} className="text-[#16A34A]" />
                ) : null}
                {s.saving ? "Saving…" : s.savedLabel || "Changes save automatically"}
              </span>
              <Link
                href={routes.experiments.list}
                onClick={(ev) => {
                  if (!isLive || s.ctx.readOnly) return;
                  // Leave only once the last edit is stored.
                  ev.preventDefault();
                  void sync.flush().then((id) => {
                    if (id || !s.ctx.draftId) router.push(routes.experiments.list);
                  });
                }}
                className={cn(cls.secondary, cls.tall)}
              >
                Save and exit
              </Link>
            </>
          ) : null}
          {s.phase === "results" && !s.paused ? (
            <button
              type="button"
              onClick={() => set({ modal: "pause" })}
              className={cn(cls.secondary, cls.tall)}
            >
              <PauseIcon />
              Pause experiment
            </button>
          ) : null}
          {s.phase === "results" && s.paused ? (
            <button
              type="button"
              onClick={() => set({ modal: "pause" })}
              className={cn(cls.primary, "px-3.5", cls.tall)}
            >
              <PlayIcon />
              Resume experiment
            </button>
          ) : null}
        </div>
      </div>

      {isEdit ? <Wizard s={s} d={d} act={act} /> : null}
      {s.phase === "success" ? (
        <Success
          d={d}
          liveBody={
            "Visitors to " +
            (shortUrl(s.form.pageUrl) || "your page") +
            " are now split between " +
            d.arms.length +
            " versions. The Control is unchanged. Results usually start appearing within a few minutes."
          }
          onViewResults={() => {
            // One results page: a live experiment's is /experiments/[id] (spec §8 #2).
            if (isLive && s.ctx.draftId) {
              router.push(routes.experiments.detail(s.ctx.draftId));
              return;
            }
            set({ phase: "results", data: "none", hoverIdx: null });
            scrollTop();
          }}
        />
      ) : null}
      {s.phase === "results" ? (
        <Results
          s={s}
          d={d}
          onHover={(i) => set((cur) => (cur.hoverIdx === i ? {} : { hoverIdx: i }))}
          onPreview={(id) => set({ ve: veFor(id, "desktop", s.form) })}
        />
      ) : null}

      {ve && isLive ? (
        <LiveVisualEditor
          form={s.form}
          initialTarget={ve.target}
          initialDevice={ve.device}
          editable={isEdit && !s.ctx.readOnly}
          viewer={s.ctx.readOnly}
          ensureDraft={sync.flush}
          onSave={saveLive}
          onExit={() => set({ ve: null })}
          onInstall={() =>
            set({ ve: null, modal: "install", instStep: 1, verify: "idle", copied: false })
          }
        />
      ) : null}
      {/* The design's mock storefront: only the `?view=` comparison states, which save nothing. */}
      {ve && !isLive ? <VisualEditor s={s} ve={ve} act={veAct} /> : null}

      <ConfirmDialog
        open={!!s.veConfirm}
        onClose={() => set({ veConfirm: null })}
        alert
        z={95}
        width={420}
        title="Discard unsaved changes?"
        body="You have edits that haven’t been saved to this variant. If you leave now, they’ll be lost."
      >
        <button type="button" onClick={() => set({ veConfirm: null })} className={cls.secondary}>
          Keep editing
        </button>
        <button type="button" onClick={confirmDiscard} className={cls.danger}>
          Discard changes
        </button>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!s.rmConfirm}
        onClose={() => set({ rmConfirm: null })}
        alert
        z={95}
        width={420}
        title={s.rmConfirm ? "Remove " + s.rmConfirm.name + "?" : ""}
        body={
          s.rmConfirm
            ? s.rmConfirm.name +
              " has " +
              s.rmConfirm.n +
              (s.rmConfirm.n === 1 ? " saved change" : " saved changes") +
              " from the visual editor. Removing it deletes those changes and splits traffic evenly between the remaining versions."
            : ""
        }
      >
        <button type="button" onClick={() => set({ rmConfirm: null })} className={cls.secondary}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            const c = s.rmConfirm;
            if (!c) return;
            set({ rmConfirm: null });
            removeVariant(c.id, c.name);
          }}
          className={cls.danger}
        >
          Remove variant
        </button>
      </ConfirmDialog>

      <InstallModal
        open={s.modal === "install"}
        s={s}
        d={d}
        pixelKey={pixelKey}
        snippet={snippet}
        onClose={closeModal}
        onStep={(n) => {
          if (s.verify === "checking") return;
          set({ instStep: n });
        }}
        onCopy={copySnippet}
        onVerify={verifyInstall}
      />

      <LaunchDialog
        open={s.modal === "confirm"}
        launching={s.launching}
        title={"Launch “" + (s.form.name.trim() || "Untitled experiment") + "”?"}
        body={
          "Visitors to " +
          (shortUrl(s.form.pageUrl) || "your page") +
          " will start seeing one of " +
          d.arms.length +
          " versions. The Control stays exactly as it is, and you can pause at any time."
        }
        d={d}
        onClose={closeModal}
        onConfirm={confirmLaunch}
      />

      <ConfirmDialog
        open={s.modal === "pause"}
        onClose={closeModal}
        width={440}
        title={s.paused ? "Resume this experiment?" : "Pause this experiment?"}
        body={
          s.paused
            ? "“" +
              (s.form.name.trim() || "This experiment") +
              "” will start showing variants to visitors again using its current traffic settings."
            : "“" +
              (s.form.name.trim() || "This experiment") +
              "” will stop showing variants, and every visitor will see the original page. Data collected so far is kept."
        }
      >
        <button type="button" onClick={closeModal} className={cls.secondary}>
          Cancel
        </button>
        <button type="button" onClick={confirmPause} className={cn(cls.primary, "font-medium")}>
          {s.paused ? "Resume experiment" : "Pause experiment"}
        </button>
      </ConfirmDialog>

      {/* Portalled so it stacks above the full-screen editor, as in the reference; only while a
          toast is showing, since the first render (server and hydration) never has one. */}
      {toast ? createPortal(<ToastHost toast={toast} />, document.body) : null}
    </div>
  );
}

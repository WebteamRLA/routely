"use client";

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CheckIcon, ChevronRightIcon, Spinner } from "@/components/rt/icons";
import { ToastHost, useToast } from "@/components/rt/toast";
import { useDraftSync } from "@/components/wizard-draft/use-draft-sync";
import {
  MAX_VARIANTS,
  armsOf,
  draftPatch,
  evenSplit,
  initState,
  liveState,
  missingResults,
  okResults,
  rebalance,
  shortUrl,
  trackKey,
  type SplitForm,
  type SplitState,
  type SplitUrlViewName,
} from "@/lib/mock/split-url";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { type WizardCtx, trackingFromChecks } from "@/lib/wizard-draft";
import { checkTrackingAction, launchExperimentAction } from "@/server/actions/experiment.actions";

import { InstallModal, LaunchDialog, PauseDialog } from "./dialogs";
import { derive } from "./model";
import { Results, Success } from "./results";
import { PauseIcon, PlayIcon, cls } from "./ui";
import { Wizard, type WizardAct } from "./wizard";

type Patch = Partial<SplitState> | ((s: SplitState) => Partial<SplitState>);

function reducer(s: SplitState, p: Patch): SplitState {
  return { ...s, ...(typeof p === "function" ? p(s) : p) };
}

/** A real draft to open (or a new one to create in `ctx.projectId`). */
export interface SplitUrlLive {
  ctx: WizardCtx;
  form: SplitForm;
  step: number;
  savedLabel: string;
}

/** The wizard's pages, as the tracking card lists them. */
function trackedPages(f: SplitForm) {
  return [
    { id: "control", url: f.controlUrl },
    ...f.variants.map((v) => ({ id: v.id, url: v.url })),
    { id: "goal", url: f.goalUrl },
  ];
}

/**
 * The Split URL test screen: a five-step setup wizard, the tracking check and launch flow, and
 * the live experiment's results — the design's `SplitURL` component.
 *
 * One state object with merge-patches, as in the reference's logic class, so each handler reads
 * like its counterpart there. With `live`, every edit autosaves to the draft, tracking checks and
 * launch go to the server, and "View results" opens the experiment's page. Without it (the
 * design's `?view=` states), the timed steps are simulated with the reference's delays.
 */
export function SplitUrlView({ view, live }: { view: SplitUrlViewName; live?: SplitUrlLive }) {
  const [s, set] = useReducer(reducer, null, () =>
    live
      ? liveState(live.ctx, live.form, { step: live.step, savedLabel: live.savedLabel })
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
    type: "SPLIT_URL",
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

  const setForm = (patch: Partial<SplitForm> | ((f: SplitForm) => Partial<SplitForm>)) => {
    set((cur) => ({
      form: { ...cur.form, ...(typeof patch === "function" ? patch(cur.form) : patch) },
      saving: !cur.ctx.readOnly,
      // A server-only problem (another test on the page) is re-judged at the next launch.
      serverIssues: [],
    }));
    if (isLive) sync.schedule();
    else later("save", 700, () => set({ saving: false, savedLabel: "Draft saved" }));
  };

  /** Checks the snippet on every page. `force` re-checks pages that passed recently. */
  const checkLive = async (force: boolean) => {
    const key = trackKey(latest.current.form);
    const id = await sync.flush();
    const res = id ? await checkTrackingAction(id, { force }) : null;
    const mapped = res?.ok
      ? trackingFromChecks(trackedPages(latest.current.form), res.data.checks)
      : null;
    set((cur) => {
      const attempts = (cur.tracking.attempts || 0) + 1;
      return {
        tracking:
          mapped?.status === "done"
            ? { status: "done", results: mapped.results, details: mapped.details, key, attempts }
            : { status: "error", results: {}, key, attempts },
      };
    });
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
        // The first check misses the last variant so the install flow is reachable.
        const results = attempts === 1 ? missingResults(cur.form) : okResults(cur.form);
        return { tracking: { status: "done", results, key: trackKey(cur.form), attempts } };
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

  const openLaunch = () => {
    if (!d.canLaunch) return;
    set({ modal: "confirm", launchError: false });
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
    fix: (n) => {
      set({ attempted: { ...s.attempted, [n]: true } });
      goStep(n);
    },
    addVariant: () =>
      setForm((f) => {
        if (f.variants.length >= MAX_VARIANTS) return {};
        const used = f.variants.map((x) => x.color);
        const color = [1, 2, 3, 4].find((c) => !used.includes(c)) ?? 1;
        const names = f.variants.map((x) => x.name.trim());
        const letter =
          ["A", "B", "C", "D"].find((l) => !names.includes("Variant " + l)) ??
          String(f.variants.length + 1);
        const vs = [
          ...f.variants,
          { id: "v" + f.nextId, name: "Variant " + letter, url: "", color },
        ];
        return {
          variants: vs,
          nextId: f.nextId + 1,
          split: evenSplit(["control", ...vs.map((x) => x.id)]),
        };
      }),
    removeVariant: (id) => {
      const v = s.form.variants.find((x) => x.id === id);
      if (!v) return;
      const vs = s.form.variants.filter((x) => x.id !== id);
      setForm({ variants: vs, split: evenSplit(["control", ...vs.map((x) => x.id)]) });
      notify(
        (v.name.trim() || "Variant") + " removed",
        "Traffic is now split evenly between " + (vs.length + 1) + " versions.",
      );
    },
    applySplit: (id, raw) => {
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
    setInclude: (raw) => setForm({ include: String(raw).replace(/[^\d]/g, "").slice(0, 3) }),
    toggleDevice: (k) => setForm((f) => ({ devices: { ...f.devices, [k]: !f.devices[k] } })),
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
    openLaunch,
  };

  const closeModal = () => {
    if (s.launching) return;
    set({ modal: null });
  };
  const copySnippet = () => {
    try {
      void navigator.clipboard?.writeText(s.ctx.snippet).catch(() => {});
    } catch {
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
          results: okResults(cur.form),
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
      // A rule failure goes back to the step it belongs to, as the design's issues list does.
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
      const checks = res.tracking.checks;
      set((cur) => {
        const mapped = trackingFromChecks(trackedPages(cur.form), checks);
        const attempts = (cur.tracking.attempts || 0) + 1;
        return {
          launching: false,
          modal: null,
          tracking:
            mapped.status === "done"
              ? { status: "done", results: mapped.results, details: mapped.details, key, attempts }
              : { status: "error", results: {}, key, attempts },
        };
      });
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
        ? "Visitors are being split between versions again."
        : "Everyone now sees the Control page. Your data is kept.",
    );
  };

  const f = s.form;
  const name = f.name.trim();
  const isEdit = s.phase === "edit";
  const head = isEdit
    ? {
        crumb: "New Split URL test",
        title: name || "New Split URL test",
        sub: "Split URL Testing · Send visitors to different page URLs and compare which converts better.",
        badge: "Draft",
        badgeBg: "#F3F4F6",
        badgeFg: "#374151",
        badgeDot: "#9CA3AF",
      }
    : {
        crumb: name || "Untitled experiment",
        title: name || "Untitled experiment",
        sub: s.hasData
          ? "Split URL Testing · Started Sep 29 · Day 15"
          : "Split URL Testing · Started today",
        badge: s.paused ? "Paused" : "Running",
        badgeBg: s.paused ? "#FEF3C7" : "#E6F4FF",
        badgeFg: s.paused ? "#92400E" : "#0060AD",
        badgeDot: s.paused ? "#F59E0B" : "#0091FF",
      };

  return (
    // The design's root sets line-height 1.45, and its controls keep the browser's `normal`
    // (Tailwind's preflight makes them inherit), which moves button labels by a pixel.
    <div
      ref={rootRef}
      className="flex flex-col gap-5 leading-[1.45] [&_button]:leading-[normal] [&_input]:leading-[normal]"
    >
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
              className="inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-[12px] font-semibold whitespace-nowrap"
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
              className={cn(cls.primary, cls.tall, "px-3.5")}
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
          s={s}
          d={d}
          onViewResults={() => {
            // One results page: a live experiment's is /experiments/[id] (spec §8 #2).
            if (isLive && s.ctx.draftId) {
              router.push(routes.experiments.detail(s.ctx.draftId));
              return;
            }
            set({ phase: "results", hasData: false, hoverIdx: null });
            scrollTop();
          }}
        />
      ) : null}
      {s.phase === "results" ? (
        <Results
          s={s}
          d={d}
          onHover={(i) => set((cur) => (cur.hoverIdx === i ? {} : { hoverIdx: i }))}
        />
      ) : null}

      <InstallModal
        open={s.modal === "install"}
        s={s}
        d={d}
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
        title={"Launch “" + (name || "Untitled experiment") + "”?"}
        body={
          "Visitors to " +
          (shortUrl(f.controlUrl) || "your Control page") +
          " will start being split between " +
          d.arms.length +
          " versions. You can pause the experiment at any time."
        }
        d={d}
        onClose={closeModal}
        onConfirm={confirmLaunch}
      />

      <PauseDialog
        open={s.modal === "pause"}
        paused={s.paused}
        name={name}
        onClose={closeModal}
        onConfirm={confirmPause}
      />

      <ToastHost toast={toast} />
    </div>
  );
}

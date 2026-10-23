import {
  ACCENT,
  ACCENT_INK,
  ACCENT_LINE,
  ACCENT_TINT,
  armsOf,
  changeCountOf,
  colorOf,
  DATASETS,
  EL_ORDER,
  STEPS,
  describe,
  fmt,
  shortUrl,
  trackKey,
  validUrl,
  validate,
  type AbState,
  type Arm,
} from "@/lib/mock/ab-test";
import { changeSummaries } from "@/lib/change-summary";

/**
 * Everything the screen displays, computed from state — the design's `renderVals()` minus the
 * event handlers, which live in the view. Pure, so each part of the screen reads the same
 * validation and tracking verdicts.
 */
export function derive(s: AbState) {
  const f = s.form;
  const att = s.attempted;
  const step = s.step;
  const errs = validate(f, s.ctx.domain, s.serverIssues);
  const valid = (n: 1 | 2 | 3 | 4) => errs[n].count === 0;
  const allValid = valid(1) && valid(2) && valid(3) && valid(4);
  const reachable = (n: number) => {
    for (let m = 1; m < n; m++) if (!valid(m as 1 | 2 | 3 | 4)) return false;
    return true;
  };
  const arms = armsOf(f);
  const pctOf = (a: Arm) => {
    const v = parseInt(f.split[a.id] ?? "", 10);
    return isNaN(v) ? 0 : v;
  };
  const countOf = (a: Arm) => changeCountOf(a);
  const metaOf = (a: Arm) => {
    if (a.id === "control") return "Original, unchanged";
    const n = countOf(a);
    return n ? n + (n === 1 ? " change" : " changes") : "No changes yet";
  };
  const pageValid = validUrl(f.pageUrl);
  const targetText =
    f.targeting === "all"
      ? "All visitors"
      : (() => {
          const l: string[] = [];
          if (f.devices.desktop) l.push("Desktop");
          if (f.devices.mobile) l.push("Mobile");
          if (f.devices.tablet) l.push("Tablet");
          return l.length ? l.join(", ") + " only" : "No devices selected";
        })();

  const steps = STEPS.map((d) => {
    const n = d.n;
    const current = n === step;
    const isError = !current && n < 5 && !!att[n] && !valid(n as 1 | 2 | 3 | 4);
    const done =
      !current && !isError && n <= (s.visited || 1) && n < 5 && valid(n as 1 | 2 | 3 | 4);
    const locked = !current && !reachable(n);
    return {
      n,
      label: d.label,
      done,
      isError,
      locked,
      current,
      aria:
        "Step " + n + ", " + d.label + (done ? ", complete" : isError ? ", needs attention" : ""),
      ring: current ? ACCENT : done ? ACCENT_TINT : isError ? "#FECACA" : "#D1D5DB",
      bg: current ? ACCENT : done ? ACCENT_TINT : isError ? "#FEF2F2" : "#FFFFFF",
      fg: current ? "#FFFFFF" : done ? ACCENT_INK : isError ? "#B91C1C" : "#6B7280",
      labelFg: current ? "#111827" : isError ? "#B91C1C" : done ? "#374151" : "#6B7280",
      line: n < step || done ? ACCENT_LINE : "#E5E7EB",
    };
  });
  const cur = STEPS[step - 1]!;
  const eCur = step < 5 ? errs[step as 1 | 2 | 3 | 4] : { count: 0 };

  const sh1 = !!att[1];
  const E1 = errs[1];
  const e1 = {
    name: sh1 ? E1.name : "",
    page: sh1 ? E1.page : "",
  };
  const variants = f.variants.map((v) => {
    const n = countOf(v);
    const err = E1.variants[v.id] || "";
    return {
      id: v.id,
      name: v.name,
      color: colorOf(v),
      n,
      statusText: n ? n + (n === 1 ? " saved change" : " saved changes") : "No changes yet",
      statusFg: n ? "#166534" : sh1 ? "#B91C1C" : "#92400E",
      openLabel: n ? "Edit changes" : "Open visual editor",
      err: sh1 ? err : "",
    };
  });

  const E2 = errs[2];
  const sh2 = !!att[2];
  const incNum = parseInt(f.include, 10);
  const incPct = isNaN(incNum) ? 0 : Math.min(100, Math.max(0, incNum));
  // The real baseline is the saved page's visitors/day over 30 days (`pageBaseline`).
  const baseline = pageValid ? s.ctx.baseline : null;
  const totalOk = E2.total === 100 && !E2.split;
  const e2 = {
    split: sh2 ? E2.split : "",
    include: sh2 ? E2.include : "",
    total: E2.total,
    totalOk,
  };
  const splitRows = arms.map((a) => {
    const bad = sh2 && (E2.low[a.id] || (!!E2.split && E2.total !== 100));
    const pc = pctOf(a);
    return {
      id: a.id,
      name: a.name,
      sub: metaOf(a),
      color: colorOf(a),
      value: f.split[a.id] != null ? f.split[a.id] : "",
      num: Math.max(1, pc),
      max: 100 - (arms.length - 1),
      est: baseline
        ? "≈ " + fmt(Math.round((((baseline * incPct) / 100) * pc) / 100)) + " visitors / day"
        : "No traffic estimate yet",
      invalid: !!bad,
    };
  });
  const tot = Math.max(E2.total, 100);
  const LABEL_FG = ["#FFFFFF", "#FFFFFF", "#111827", "#111827", "#FFFFFF"];
  const splitSegs = arms
    .map((a) => {
      const pc = pctOf(a);
      const mm = /^Variant\s+(\S+)$/i.exec(a.name);
      const shortName = a.id === "control" ? "Control" : mm ? mm[1] : a.name;
      return {
        id: a.id,
        width: ((pc / tot) * 100).toFixed(2) + "%",
        color: colorOf(a),
        fg: LABEL_FG[a.color] || "#FFFFFF",
        label: pc >= 14 ? shortName + " · " + pc + "%" : pc >= 6 ? pc + "%" : "",
      };
    })
    .filter((b) => parseFloat(b.width) > 0);
  const splitBar = splitSegs.map((b) => ({ id: b.id, width: b.width, color: b.color }));
  const splitAria = "Traffic split: " + arms.map((a) => a.name + " " + pctOf(a) + "%").join(", ");
  const incDisplay = (isNaN(incNum) ? "—" : incNum) + "%";
  const incCaption = baseline
    ? (incPct >= 100
        ? "All matching visitors enter the experiment."
        : incPct +
          "% of matching visitors enter the experiment, about " +
          fmt(Math.round((baseline * incPct) / 100)) +
          " a day. Everyone else sees the original page.") +
      " Based on ~" +
      fmt(baseline) +
      " visitors/day to this page over the last 30 days."
    : pageValid
      ? (incPct >= 100
          ? "All matching visitors enter the experiment."
          : incPct +
            "% of matching visitors enter the experiment. Everyone else sees the original page.") +
        " No traffic estimate yet — this page hasn’t reported any visits in the last 30 days."
      : "Add a valid page URL in step 1 to see traffic estimates.";
  const incRange = isNaN(incNum) ? 1 : Math.min(100, Math.max(1, incNum));

  const allDevices = f.devices.desktop && f.devices.mobile && f.devices.tablet;
  const targetHint = allDevices
    ? "All three device types are selected, which is the same as All visitors."
    : "Visitors on other devices see the original page and aren’t counted.";
  const e3 = { devices: att[3] ? errs[3].devices : "" };
  const e4 = { url: att[4] ? errs[4].url : "" };

  const tr = s.tracking;
  const stale = tr.status === "done" && tr.key !== trackKey(f);
  const pages = [
    {
      id: "page" as const,
      label: "Tested page",
      url: shortUrl(f.pageUrl) || "No URL yet",
      set: !!shortUrl(f.pageUrl),
    },
    {
      id: "goal" as const,
      label: "Goal page",
      url: shortUrl(f.goalUrl) || "No URL yet",
      set: !!shortUrl(f.goalUrl),
    },
  ];
  const missing =
    tr.status === "done" && !stale ? pages.filter((pg) => tr.results[pg.id] === "missing") : [];
  const allOk = tr.status === "done" && !stale && missing.length === 0;
  const trView = {
    isChecking: tr.status === "checking",
    isError: tr.status === "error",
    isMissing: missing.length > 0,
    showInstall: missing.length > 0 || tr.status === "error",
    recheckLabel:
      tr.status === "checking" ? "Checking…" : tr.status === "error" ? "Try again" : "Check again",
    pill:
      tr.status === "checking"
        ? "Checking…"
        : tr.status === "error"
          ? "Couldn’t check"
          : stale || tr.status === "idle"
            ? "Not checked"
            : missing.length
              ? "Tracking required"
              : "All pages ready",
    pillBg:
      tr.status === "checking"
        ? "#F3F4F6"
        : allOk
          ? "#DCFCE7"
          : tr.status === "error"
            ? "#FEF2F2"
            : "#FEF3C7",
    pillFg:
      tr.status === "checking"
        ? "#4B5563"
        : allOk
          ? "#166534"
          : tr.status === "error"
            ? "#B91C1C"
            : "#92400E",
    missingText: missing.length
      ? "We couldn’t find the Routely snippet on " +
        missing.map((m) => m.url).join(", ") +
        ". Install it to launch — without it, page views won’t be counted." +
        // The server's reason, when it knows one (e.g. the snippet of a different project).
        [...new Set(missing.map((m) => tr.details?.[m.id]).filter(Boolean))]
          .map((reason) => " " + reason)
          .join("")
      : "",
    rows: pages.map((pg) => {
      const stt =
        tr.status === "checking"
          ? "checking"
          : tr.status === "done" && !stale
            ? tr.results[pg.id] || "ok"
            : "idle";
      return {
        id: pg.id,
        label: pg.label,
        url: pg.url,
        stt,
        iconBg: stt === "ok" ? "#DCFCE7" : stt === "missing" ? "#FEF3C7" : "#F3F4F6",
        iconFg: stt === "ok" ? "#166534" : stt === "missing" ? "#92400E" : "#6B7280",
        text:
          stt === "checking"
            ? "Checking…"
            : stt === "ok"
              ? "Snippet found"
              : stt === "missing"
                ? "Snippet not found"
                : "Not checked",
        textFg: stt === "ok" ? "#166534" : stt === "missing" ? "#92400E" : "#6B7280",
      };
    }),
  };
  const canLaunch = allValid && allOk && !s.launching && !s.ctx.readOnly;
  const hint = !allValid
    ? "Finish every step to launch."
    : tr.status === "checking"
      ? "Checking tracking…"
      : missing.length
        ? "Install tracking to launch."
        : stale || tr.status === "idle" || tr.status === "error"
          ? "Check tracking to launch."
          : "Everything’s ready to go.";
  const foot = {
    nextLabel: step === 4 ? "Review" : "Continue",
    launchDisabled: !allValid || tr.status === "checking" || s.launching || s.ctx.readOnly,
    hint,
    hintFg: canLaunch ? "#166534" : "#6B7280",
  };

  const rvArms = arms.map((a) => ({
    id: a.id,
    name: a.name,
    color: colorOf(a),
    pct: pctOf(a) + "%",
    meta: metaOf(a),
  }));
  const issues = ([1, 2, 3, 4] as const)
    .filter((n) => !valid(n))
    .map((n) => ({
      n,
      label:
        STEPS[n - 1]!.label + ": " + errs[n].count + (errs[n].count === 1 ? " issue" : " issues"),
    }));
  const include = isNaN(incNum) ? "—" : String(incNum);
  const rv = {
    name: f.name.trim() || "Untitled experiment",
    page: shortUrl(f.pageUrl) || "No page URL yet",
    arms: rvArms,
    versions: arms.map((a) => {
      const list =
        a.id === "control"
          ? []
          : a.visual
            ? changeSummaries(a.visual)
            : EL_ORDER.filter((id) => a.changes && a.changes[id]).map((id) => {
                const dd = describe(id, a.changes[id]!);
                return dd.label + ": " + dd.detail;
              });
      return {
        id: a.id,
        name: a.name,
        color: colorOf(a),
        meta: a.id === "control" ? "Original page, unchanged" : metaOf(a),
        changes: list,
      };
    }),
    include: include + "% of visitors on the page enter the experiment",
    includeShort: include + "%",
    targeting: targetText,
    goalUrl: shortUrl(f.goalUrl) || "No goal page yet",
    issues,
  };
  const readyCount = ([1, 2, 3, 4] as const).filter((k) => valid(k)).length;
  const sum = {
    page: shortUrl(f.pageUrl) || "Page URL not set yet",
    pageFg: f.pageUrl.trim() ? "#4B5563" : "#6B7280",
    versions: arms.map((a) => {
      const n = countOf(a);
      return {
        id: a.id,
        name: a.name,
        color: colorOf(a),
        meta: metaOf(a),
        metaFg: a.id === "control" ? "#6B7280" : n ? "#166534" : "#92400E",
      };
    }),
    include: include + "% of visitors on the page are included",
    goal: shortUrl(f.goalUrl) || "Goal page not set yet",
    goalFg: f.goalUrl.trim() ? "#4B5563" : "#6B7280",
    ready: readyCount + " of 4 steps ready",
    readyBg: readyCount === 4 ? "#DCFCE7" : "#F3F4F6",
    readyFg: readyCount === 4 ? "#166534" : "#4B5563",
    showEdit: (k: number) => k !== step && reachable(k),
  };

  const head =
    s.phase === "edit"
      ? {
          crumb: "New A/B test",
          title: f.name.trim() || "New A/B test",
          sub: "A/B Testing · Test changes to elements on a page without changing its URL.",
          badge: "Draft",
          badgeBg: "#F3F4F6",
          badgeFg: "#374151",
          badgeDot: "#9CA3AF",
        }
      : {
          crumb: f.name.trim() || "Untitled experiment",
          title: f.name.trim() || "Untitled experiment",
          sub: "A/B Testing · " + (s.data !== "none" ? DATASETS[s.data].label : "Started today"),
          badge: s.paused ? "Paused" : "Running",
          badgeBg: s.paused ? "#FEF3C7" : "#E6F4FF",
          badgeFg: s.paused ? "#92400E" : "#0060AD",
          badgeDot: s.paused ? "#F59E0B" : "#0091FF",
        };

  return {
    f,
    errs,
    allValid,
    reachable,
    arms,
    pctOf,
    metaOf,
    pageValid,
    steps,
    cur,
    errBanner: step < 5 && !!att[step] && eCur.count > 0 ? eCur.count : 0,
    e1,
    e2,
    e3,
    e4,
    variants,
    splitRows,
    splitSegs,
    splitBar,
    splitAria,
    incDisplay,
    incCaption,
    incRange,
    targetHint,
    tr: trView,
    stale,
    missing,
    allOk,
    pages,
    foot,
    rv,
    sum,
    head,
  };
}

export type Derived = ReturnType<typeof derive>;

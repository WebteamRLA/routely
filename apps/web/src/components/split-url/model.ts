import {
  armsOf,
  colorOf,
  norm,
  pctOf,
  shortUrl,
  trackKey,
  validate,
  type Arm,
  type SplitState,
  type StepErrors,
} from "@/lib/mock/split-url";

export interface Page {
  id: string;
  label: string;
  url: string;
}

/** What more than one part of the screen reads, computed once per render from the state. */
export interface Derived {
  errs: StepErrors;
  valid(n: number): boolean;
  allValid: boolean;
  reachable(n: number): boolean;
  arms: Arm[];
  pct(id: string): number;
  /** Arms as the review, success, launch and details panels list them. */
  rvArms: { id: string; name: string; url: string; href: string; color: string; pct: string }[];
  splitBar: { width: string; color: string }[];
  targetText: string;
  includeShort: string;
  goalUrlText: string;
  pages: Page[];
  stale: boolean;
  missing: Page[];
  allOk: boolean;
  canLaunch: boolean;
}

export function derive(s: SplitState): Derived {
  const f = s.form;
  const errs = validate(f, s.ctx.domain, s.serverIssues);
  const valid = (n: number) => errs[n as 1 | 2 | 3 | 4].count === 0;
  const allValid = valid(1) && valid(2) && valid(3) && valid(4);
  const reachable = (n: number) => {
    for (let m = 1; m < n; m++) if (!valid(m)) return false;
    return true;
  };
  const arms = armsOf(f);
  const pct = (id: string) => pctOf(f, id);
  const scale = Math.max(errs[2].total, 100);
  const incNum = parseInt(f.include, 10);

  const tr = s.tracking;
  const stale = tr.status === "done" && tr.key !== trackKey(f);
  const pages: Page[] = [
    ...arms.map((a) => ({
      id: a.id,
      label: (a.name.trim() || "Variant") + " page",
      url: shortUrl(a.url) || "No URL yet",
    })),
    { id: "goal", label: "Conversion page", url: shortUrl(f.goalUrl) || "No URL yet" },
  ];
  const missing =
    tr.status === "done" && !stale ? pages.filter((pg) => tr.results[pg.id] === "missing") : [];
  const allOk = tr.status === "done" && !stale && missing.length === 0;

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

  return {
    errs,
    valid,
    allValid,
    reachable,
    arms,
    pct,
    rvArms: arms.map((a) => ({
      id: a.id,
      name: a.name.trim() || "Unnamed variant",
      url: a.url.trim() ? shortUrl(a.url) : "No URL yet",
      href: norm(a.url) || "#",
      color: colorOf(a),
      pct: pct(a.id) + "%",
    })),
    splitBar: arms
      .map((a) => ({ width: ((pct(a.id) / scale) * 100).toFixed(2) + "%", color: colorOf(a) }))
      .filter((b) => parseFloat(b.width) > 0),
    targetText,
    includeShort: (isNaN(incNum) ? "—" : incNum) + "%",
    goalUrlText: f.goalUrl.trim() ? shortUrl(f.goalUrl) : "No conversion URL yet",
    pages,
    stale,
    missing,
    allOk,
    canLaunch: allValid && allOk && !s.launching && !s.ctx.readOnly,
  };
}

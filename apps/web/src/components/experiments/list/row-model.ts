import { armName } from "@/lib/domain";
import { pathOf } from "@/lib/domain-normalize";
import { fAgo, fDate, fN, fP, fS, minutesSince } from "@/lib/format";
import { computeStats } from "@/lib/stats";
import { TYPE_LABEL, verdict } from "@/lib/verdict";
import type { ExperimentListItem } from "@/lib/view-models";

/** One list row, pre-formatted (prototype `V.rows`, L2770–2773). */
export interface ListRow {
  id: string;
  name: string;
  path: string;
  created: string;
  type: string;
  weights: number[];
  split: string;
  goal: string;
  visitors: string;
  cr: string;
  liftCell: string;
  leaderSub: string;
  leader: string;
  lift: string;
  liftColor: string;
  updated: string;
}

export function listRow(e: ExperimentListItem, threshold: number, timezone: string): ListRow {
  const totals = [...e.totals].sort((a, b) => a.position - b.position);
  const st = computeStats(totals.map((t) => ({ name: armName(t.position), v: t.v, c: t.c })));
  const l = verdict(e.status, e.winnerPosition, st, threshold).leader;
  const has = st.v > 0;
  return {
    id: e.id,
    name: e.name,
    path: e.path || pathOf(e.url),
    created: fDate(e.createdAt, timezone),
    type: TYPE_LABEL[e.type],
    weights: e.arms.map((a) => a.weight),
    split: e.arms.map((a) => a.weight).join(" / "),
    goal: e.goal?.name ?? "Not set",
    visitors: has ? fN(st.v) : "—",
    cr: has ? fP(st.c / st.v, 2) : "—",
    liftCell: l && l.i > 0 && has ? fS(l.lift) : "—",
    leaderSub: !has ? "" : l && l.i > 0 ? l.name : "Control leads",
    leader: l && has ? l.name : "—",
    lift: l && l.i > 0 && has ? fS(l.lift) : "",
    liftColor: l && l.lift >= 0 ? "#0F7A52" : "#B4361F",
    updated: fAgo(minutesSince(e.updatedAt)),
  };
}

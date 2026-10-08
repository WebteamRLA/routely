"use client";

import { useState } from "react";

import { ArmSwatch, CardTitle, Section } from "@/components/rl";
import { pathOf } from "@/lib/domain-normalize";
import type { ExperimentKind } from "@/lib/domain";
import { changeLabel } from "@/lib/editor";
import { fN, fP, fS } from "@/lib/format";
import { phi, type ArmStat } from "@/lib/stats";

function detail(a: ArmStat, type: ExperimentKind): string {
  if (type === "redirect") return pathOf(a.url ?? "");
  return a.changes?.length ? a.changes.map(changeLabel).join(" · ") : "Original page";
}

const SELECT =
  "h-8 cursor-pointer rounded-md border border-input bg-card px-1.5 text-[12.5px] font-bold outline-none focus:border-brand focus:ring-3 focus:ring-primary/15";

/** Any two arms side by side, with the relative difference and chance B beats A. */
export function HeadToHead({ arms, type }: { arms: ArmStat[]; type: ExperimentKind }) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(Math.min(1, arms.length - 1));
  const nA = Math.min(a, arms.length - 1);
  const nB = Math.min(b, arms.length - 1);
  const A = arms[nA]!;
  const B = arms[nB]!;

  let lift = "—";
  let color = "#5B6579";
  let text = "Pick two different variants to compare.";
  let prob = "";
  if (nA !== nB) {
    const se = Math.sqrt(
      (A.cr * (1 - A.cr)) / Math.max(1, A.v) + (B.cr * (1 - B.cr)) / Math.max(1, B.v),
    );
    const rel = A.cr ? (B.cr - A.cr) / A.cr : 0;
    const pb = se ? phi((B.cr - A.cr) / se) : 0.5;
    lift = fS(rel);
    color = rel >= 0 ? "#0F7A52" : "#B4361F";
    text = `${B.name} converts ${fS(rel)} ${rel >= 0 ? "better" : "worse"} than ${A.name}.`;
    prob = `${Math.round(pb * 100)}% chance ${B.name} is genuinely better.`;
  }

  return (
    <Section className="flex flex-col gap-3.5 p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <CardTitle>Head-to-head</CardTitle>
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Compare"
            value={nA}
            onChange={(e) => setA(Number(e.target.value))}
            className={SELECT}
          >
            {arms.map((x) => (
              <option key={x.i} value={x.i}>
                {x.name}
              </option>
            ))}
          </select>
          <span className="text-xs font-bold text-ink-3">vs</span>
          <select
            aria-label="Against"
            value={nB}
            onChange={(e) => setB(Number(e.target.value))}
            className={SELECT}
          >
            {arms.map((x) => (
              <option key={x.i} value={x.i}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {[A, B].map((x, k) => (
          <div key={k} className="min-w-0 rounded-lg border border-border p-3">
            <div className="flex items-center gap-1.5">
              <ArmSwatch size={8} color={x.color} />
              <span className="text-[13px] font-extrabold">{x.name}</span>
            </div>
            <div className="mt-1.5 font-heading text-2xl font-semibold tabular-nums">
              {fP(x.cr, 2)}
            </div>
            <div className="text-xs text-ink-3">
              {fN(x.c)} of {fN(x.v)} visitors
            </div>
            <div className="mt-1.5 truncate text-[11.5px] text-ink-2">{detail(x, type)}</div>
          </div>
        ))}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="font-heading text-[22px] font-semibold" style={{ color }}>
          {lift}
        </span>
        <div className="text-[13px] leading-[1.45]">
          <div className="font-bold">{text}</div>
          {prob ? <div className="text-ink-3">{prob}</div> : null}
        </div>
      </div>
    </Section>
  );
}

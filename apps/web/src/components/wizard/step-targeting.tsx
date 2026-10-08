"use client";

import type { ReactNode } from "react";

import {
  CardTitle,
  CheckChip,
  FieldError,
  NavyStrip,
  RemovableChip,
  Section,
  Segmented,
} from "@/components/rl";
import {
  ALL_DEVICES,
  COUNTRIES,
  type ConditionField,
  type ConditionOp,
  type Device,
  type PageMatch,
  type TargetCondition,
  type Targeting,
} from "@/lib/domain";
import { MATCH_OPTIONS, countryName, matches, targetSummary } from "@/lib/targeting";
import { cn } from "@/lib/utils";

import type { StepProps } from "./types";
import { StepHeading } from "./ui";

/** Which optional audience rows are open (a row also shows while its rule is in effect). */
export type RuleShow = Partial<Record<"device" | "visitor" | "geo" | "params", boolean>>;

const FIELD_OPTS: { value: ConditionField; label: string }[] = [
  { value: "utm_source", label: "UTM source" },
  { value: "utm_medium", label: "UTM medium" },
  { value: "utm_campaign", label: "UTM campaign" },
  { value: "query", label: "Query parameter" },
  { value: "referrer", label: "Referrer URL" },
];
const OP_OPTS: { value: ConditionOp; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "exists" },
];
const EMPTY_CONDITION: TargetCondition = { field: "utm_source", key: "", op: "equals", value: "" };

const selectCls =
  "h-9 cursor-pointer rounded-md border border-input bg-white px-2 text-[13px] outline-none focus:border-brand focus:ring-3 focus:ring-primary/15";
const monoInput =
  "h-9 rounded-md border bg-white px-2.5 font-mono text-[12.5px] outline-none focus:border-brand focus:ring-3 focus:ring-primary/15";

/** Which audience rows are visible: opened by the user, or in effect in the targeting. */
export function visibleRules(t: Targeting, show: RuleShow, isRedirect: boolean) {
  return {
    device: !!show.device || t.devices.length < 3,
    visitor: !isRedirect && (!!show.visitor || t.audience !== "all"),
    geo: !isRedirect && (!!show.geo || t.geo === "some"),
    params: !isRedirect && (!!show.params || t.conditions.length > 0),
  };
}

/** Step 5 — Targeting (design L1000–1082). */
export function StepTargeting({
  draft,
  update,
  err,
  show,
  setShow,
}: StepProps & { show: RuleShow; setShow: (k: keyof RuleShow, on: boolean) => void }) {
  const R = draft.type === "redirect";
  const t = draft.targeting;
  const setT = (fn: (t: Targeting) => Targeting) =>
    update((d) => ({ ...d, targeting: fn(d.targeting) }));
  const errPattern = err("targeting", "pattern");
  const m = matches(t.match, t.pattern, t.testUrl);
  const hasTest = !!t.testUrl.trim() && !!t.pattern.trim();

  const vis = visibleRules(t, show, R);
  const nR = [vis.device, vis.visitor, vis.geo, vis.params].filter(Boolean).length;
  const audCount = R
    ? vis.device && t.devices.length < 3
      ? `${t.devices.length} of 3 device types`
      : "All visitors · all devices"
    : nR
      ? `${nR} rule${nR > 1 ? "s" : ""} · visitors must match all`
      : "No rules · everyone qualifies";

  const allOn = ALL_DEVICES.every((k) => t.devices.includes(k));
  const toggleDevice = (k: Device) =>
    setT((x) => {
      const ds = x.devices;
      if (ALL_DEVICES.every((z) => ds.includes(z))) return { ...x, devices: [k] };
      const n = ds.includes(k) ? ds.filter((z) => z !== k) : [...ds, k];
      return { ...x, devices: n.length ? n : [...ALL_DEVICES] };
    });

  const setCond = (i: number, patch: Partial<TargetCondition>) =>
    setT((x) => ({
      ...x,
      conditions: x.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    }));

  const RULES: { key: keyof RuleShow; label: string; on: boolean; add: () => void }[] = [
    { key: "device", label: "Device", on: vis.device, add: () => setShow("device", true) },
    {
      key: "geo",
      label: "Country",
      on: vis.geo,
      add: () => {
        setShow("geo", true);
        setT((x) => ({ ...x, geo: "some" }));
      },
    },
    {
      key: "visitor",
      label: "New vs returning",
      on: vis.visitor,
      add: () => {
        setShow("visitor", true);
        setT((x) => ({ ...x, audience: "new" }));
      },
    },
    {
      key: "params",
      label: "Query parameter / UTM",
      on: vis.params,
      add: () => {
        setShow("params", true);
        setT((x) => (x.conditions.length ? x : { ...x, conditions: [{ ...EMPTY_CONDITION }] }));
      },
    },
  ];
  const addRules = RULES.filter((r, i) => !r.on && (!R || i === 0));
  const allRules = !addRules.length && !R;

  return (
    <>
      <StepHeading title="Who enters the experiment">
        Start broad. Add audience rules only when your hypothesis is about a specific segment, since
        every rule shrinks the sample.
      </StepHeading>
      <NavyStrip eyebrow="In plain English">{targetSummary(t)}</NavyStrip>

      <Section as="div" padded className="gap-3">
        <CardTitle as="h3">Page targeting</CardTitle>
        <div className="flex flex-wrap gap-2.5">
          <select
            aria-label="Page match"
            value={t.match}
            onChange={(e) => {
              const v = e.target.value as PageMatch;
              setT((x) => ({ ...x, match: v }));
            }}
            className={cn(selectCls, "h-[42px] px-2.5 text-[13.5px]")}
          >
            {MATCH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Page pattern"
            name="pattern"
            value={t.pattern}
            placeholder="https://example.com/landing-page"
            onChange={(e) => {
              const v = e.target.value;
              setT((x) => ({ ...x, pattern: v }));
            }}
            aria-invalid={errPattern ? true : undefined}
            className={cn(
              monoInput,
              "h-[42px] min-w-0 flex-[1_1_260px] px-3 text-[13px]",
              errPattern ? "border-danger" : "border-input",
            )}
          />
        </div>
        <FieldError>{errPattern}</FieldError>
        <div className="flex flex-wrap items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5">
          <span className="text-[12.5px] font-extrabold text-ink-2">Test a URL</span>
          <input
            aria-label="Test a URL"
            value={t.testUrl}
            placeholder="Paste any URL to check it"
            onChange={(e) => {
              const v = e.target.value;
              setT((x) => ({ ...x, testUrl: v }));
            }}
            className={cn(monoInput, "h-[34px] min-w-0 flex-[1_1_220px] border-input")}
          />
          {hasTest ? (
            <span
              role="status"
              className={cn(
                "rounded-md px-2 py-1 text-[12.5px] font-bold",
                m === true ? "bg-[#E6F5EE] text-success-text" : "bg-[#FCE9E6] text-danger-text",
              )}
            >
              {m === "invalid"
                ? "Invalid pattern"
                : m
                  ? "Match · visitors on this URL enter the experiment"
                  : "No match · visitors on this URL won’t enter the experiment"}
            </span>
          ) : null}
        </div>
      </Section>

      <Section as="div">
        <div className="flex flex-wrap items-baseline justify-between gap-2.5 border-b border-divider px-5 py-4">
          <CardTitle as="h3">Audience</CardTitle>
          <span className="text-[12.5px] text-ink-3">{audCount}</span>
        </div>
        {!nR ? (
          <div className="flex items-center gap-3 border-b border-divider px-5 py-4">
            <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-[#E6F5EE] text-xs font-black text-success-text">
              ✓
            </span>
            <div>
              <div className="font-extrabold">All visitors</div>
              <div className="mt-px text-[13px] text-ink-3">
                Anyone on a matching page can be assigned, on any device.
              </div>
            </div>
          </div>
        ) : null}

        {vis.device ? (
          <RuleRow
            title="Device"
            sub="Pick one or more"
            onRemove={() => {
              setShow("device", false);
              setT((x) => ({ ...x, devices: [...ALL_DEVICES] }));
            }}
          >
            <div className="flex flex-wrap gap-1.5">
              <CheckChip
                checked={allOn}
                onChange={() => setT((x) => ({ ...x, devices: [...ALL_DEVICES] }))}
              >
                All devices
              </CheckChip>
              {(
                [
                  ["desktop", "Desktop"],
                  ["mobile", "Mobile"],
                  ["tablet", "Tablet"],
                ] as const
              ).map(([k, l]) => (
                <CheckChip
                  key={k}
                  checked={!allOn && t.devices.includes(k)}
                  onChange={() => toggleDevice(k)}
                >
                  {l}
                </CheckChip>
              ))}
            </div>
            <FieldError>{err("targeting", "devices")}</FieldError>
          </RuleRow>
        ) : null}

        {vis.visitor ? (
          <RuleRow
            title="Visitor type"
            sub="Based on Routely cookie"
            onRemove={() => {
              setShow("visitor", false);
              setT((x) => ({ ...x, audience: "all" }));
            }}
          >
            <Segmented
              ariaLabel="Visitor type"
              options={[
                { value: "new", label: "New visitors" },
                { value: "returning", label: "Returning visitors" },
              ]}
              value={t.audience}
              onChange={(k) => setT((x) => ({ ...x, audience: k }))}
            />
            <span className="text-[12.5px] text-ink-3">
              New = no previous Routely visitor cookie on this domain.
            </span>
          </RuleRow>
        ) : null}

        {vis.geo ? (
          <RuleRow
            title="Country"
            sub="From visitor IP"
            gap="gap-2"
            onRemove={() => {
              setShow("geo", false);
              setT((x) => ({ ...x, geo: "all", countries: [] }));
            }}
          >
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Include or exclude"
                value={t.geoMode}
                onChange={(e) => {
                  const v = e.target.value as Targeting["geoMode"];
                  setT((x) => ({ ...x, geoMode: v }));
                }}
                className={selectCls}
              >
                <option value="include">Include only</option>
                <option value="exclude">Exclude</option>
              </select>
              <select
                aria-label="Add country"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v)
                    setT((x) => ({
                      ...x,
                      geo: "some",
                      countries: x.countries.includes(v) ? x.countries : [...x.countries, v],
                    }));
                }}
                className={cn(selectCls, "flex-[1_1_180px]")}
              >
                <option value="">+ Add country</option>
                {COUNTRIES.filter((c) => !t.countries.includes(c.code)).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {t.countries.length ? (
              <div className="flex flex-wrap gap-1.5">
                {t.countries.map((c) => (
                  <RemovableChip
                    key={c}
                    label={countryName(c)}
                    onRemove={() =>
                      setT((x) => ({ ...x, countries: x.countries.filter((z) => z !== c) }))
                    }
                  >
                    {countryName(c)}
                  </RemovableChip>
                ))}
              </div>
            ) : null}
            <FieldError>{err("targeting", "geo")}</FieldError>
          </RuleRow>
        ) : null}

        {vis.params ? (
          <RuleRow
            title="URL parameters"
            sub="UTM, query, referrer"
            gap="gap-2"
            wide
            onRemove={() => {
              setShow("params", false);
              setT((x) => ({ ...x, conditions: [] }));
            }}
          >
            {t.conditions.length > 1 ? (
              <Segmented
                size="xs"
                ariaLabel="Condition logic"
                options={[
                  { value: "all", label: "Match all" },
                  { value: "any", label: "Match any" },
                ]}
                value={t.logic}
                onChange={(k) => setT((x) => ({ ...x, logic: k }))}
              />
            ) : null}
            {t.conditions.map((c, i) => {
              const ce = err("targeting", "c" + i);
              const ke = err("targeting", "k" + i);
              return (
                <div key={i} className="flex flex-col gap-2">
                  {i > 0 ? (
                    <div className="text-[11px] font-extrabold tracking-[0.1em] text-ink-3">
                      {t.logic === "all" ? "AND" : "OR"}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Field"
                      value={c.field}
                      onChange={(e) => setCond(i, { field: e.target.value as ConditionField })}
                      className={selectCls}
                    >
                      {FIELD_OPTS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {c.field === "query" ? (
                      <input
                        aria-label="Parameter name"
                        value={c.key}
                        placeholder="param name"
                        onChange={(e) => setCond(i, { key: e.target.value })}
                        className={cn(
                          monoInput,
                          "w-[120px]",
                          ke ? "border-danger" : "border-input",
                        )}
                      />
                    ) : null}
                    <select
                      aria-label="Operator"
                      value={c.op}
                      onChange={(e) => setCond(i, { op: e.target.value as ConditionOp })}
                      className={selectCls}
                    >
                      {OP_OPTS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {c.op !== "exists" ? (
                      <input
                        aria-label="Value"
                        value={c.value}
                        placeholder="value"
                        onChange={(e) => setCond(i, { value: e.target.value })}
                        className={cn(
                          monoInput,
                          "min-w-0 flex-[1_1_120px]",
                          ce ? "border-danger" : "border-input",
                        )}
                      />
                    ) : null}
                    <button
                      type="button"
                      aria-label="Remove condition"
                      onClick={() =>
                        setT((x) => ({ ...x, conditions: x.conditions.filter((_, j) => j !== i) }))
                      }
                      className="h-9 cursor-pointer border-0 bg-transparent px-2 text-[12.5px] font-bold text-ink-3"
                    >
                      Remove
                    </button>
                  </div>
                  <FieldError>{ce || ke}</FieldError>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                setT((x) => ({ ...x, conditions: [...x.conditions, { ...EMPTY_CONDITION }] }))
              }
              className="h-[30px] cursor-pointer self-start rounded-md border border-dashed border-[#B9C6EE] bg-transparent px-2.5 text-[12.5px] font-extrabold text-brand"
            >
              + Add condition
            </button>
          </RuleRow>
        ) : null}

        {addRules.length || allRules ? (
          <div className="flex flex-wrap items-center gap-2 rounded-b-lg bg-[#FAFBFC] px-5 py-3">
            {addRules.length ? (
              <span className="mr-1 text-[12.5px] font-extrabold text-ink-2">Narrow by</span>
            ) : null}
            {addRules.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={r.add}
                className="h-[30px] cursor-pointer rounded-md border border-dashed border-[#B9C6EE] bg-white px-2.5 text-[12.5px] font-bold text-brand hover:bg-brand-tint"
              >
                + {r.label}
              </button>
            ))}
            {allRules ? (
              <span className="text-[12.5px] text-ink-3">All rule types are in use.</span>
            ) : null}
          </div>
        ) : null}
      </Section>
    </>
  );
}

function RuleRow({
  title,
  sub,
  onRemove,
  children,
  gap = "gap-1.5",
  wide = false,
}: {
  title: string;
  sub: string;
  onRemove: () => void;
  children: ReactNode;
  gap?: string;
  wide?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5 border-b border-divider px-5 py-3.5">
      <div className="flex-[0_0_150px] pt-[7px]">
        <div className="text-[13.5px] font-extrabold">{title}</div>
        <div className="mt-0.5 text-xs text-ink-3">{sub}</div>
      </div>
      <div
        className={cn("flex min-w-0 flex-col", gap, wide ? "flex-[1_1_360px]" : "flex-[1_1_300px]")}
      >
        {children}
      </div>
      <button
        type="button"
        aria-label={`Remove ${title.toLowerCase()} rule`}
        onClick={onRemove}
        className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-white text-base text-ink-3 hover:bg-muted hover:text-danger-text"
      >
        ×
      </button>
    </div>
  );
}

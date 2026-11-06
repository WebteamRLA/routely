"use client";

import { useEffect, type ReactNode } from "react";

import { WarningIcon } from "@/components/rt/icons";
import { METHOD_LABELS, type EventStatus } from "@/lib/events";
import { ACCENT, ACCENT_INK, ACCENT_LINE, ACCENT_WASH } from "@/lib/mock/split-url";
import { routes } from "@/lib/routes";
import { type WizardCtx, type WizardEvent, wizardEvents } from "@/lib/wizard-draft";
import { getEventLibraryAction } from "@/server/actions/event.actions";

/** The goal step's parts both wizards share: the goal-type tile and the event picker. */

export const CUSTOM_EVENT_HINT =
  "A conversion counts when a visitor from any version does something you’ve set up as an event, such as clicking a button or sending a form.";

const STATUS_PILL: Record<EventStatus["tone"], { bg: string; fg: string }> = {
  ok: { bg: "#DCFCE7", fg: "#166534" },
  warn: { bg: "#FEF3C7", fg: "#92400E" },
  fail: { bg: "#FEF2F2", fg: "#B91C1C" },
  idle: { bg: "#F3F4F6", fg: "#4B5563" },
};

export function GoalTypeOption({
  checked,
  onSelect,
  icon,
  title,
  children,
}: {
  checked: boolean;
  onSelect(): void;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-3 rounded-[12px] border-[1.5px] border-solid p-4"
      style={{
        borderColor: checked ? ACCENT_LINE : "#E5E7EB",
        background: checked ? ACCENT_WASH : "#FFFFFF",
      }}
    >
      <input
        type="radio"
        name="rt-goaltype"
        checked={checked}
        onChange={onSelect}
        className="m-0 mt-px size-[18px] flex-none"
        style={{ accentColor: ACCENT }}
      />
      <span
        aria-hidden
        className="inline-flex size-8 flex-none items-center justify-center rounded-[8px] border bg-white"
        style={{
          color: checked ? ACCENT_INK : "#4B5563",
          borderColor: checked ? ACCENT_LINE : "#E5E7EB",
        }}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[14px] font-semibold text-[#111827]">{title}</span>
        <span className="text-[13px] leading-[19px] text-[#6B7280]">{children}</span>
      </span>
    </label>
  );
}

const LINK =
  "font-medium text-[#0060AD] underline underline-offset-2 hover:text-[#004C8A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]";

/** Opens the Library beside the wizard; the list refreshes on coming back. */
function LibraryLink({ projectId, children }: { projectId: string; children: ReactNode }) {
  return (
    <a href={routes.projects.events(projectId)} target="_blank" rel="noopener" className={LINK}>
      {children}
    </a>
  );
}

/**
 * The project's Event Library as a choice. An event's status only ever warns: a draft saves and
 * launches whatever it says, because the event may simply not have happened yet.
 */
export function EventGoalFields({
  ctx,
  selectedId,
  onSelect,
  onEvents,
  error,
}: {
  ctx: WizardCtx;
  selectedId: string | null;
  onSelect(event: WizardEvent): void;
  onEvents(events: readonly WizardEvent[]): void;
  /** The step's "choose an event" message, once the customer has tried to continue. */
  error: ReactNode;
}) {
  const { live, projectId } = ctx;
  const events = ctx.events ?? [];
  const selected = events.find((event) => event.id === selectedId) ?? null;

  // The Library opens in its own tab: an event set up there appears on coming back.
  useEffect(() => {
    if (!live) return;
    let current = true;
    const refresh = () => {
      void getEventLibraryAction(projectId)
        .then((res) => {
          if (current && res.ok) onEvents(wizardEvents(res.data.events));
        })
        // The list on screen stays; the next focus tries again.
        .catch(() => {});
    };
    window.addEventListener("focus", refresh);
    return () => {
      current = false;
      window.removeEventListener("focus", refresh);
    };
  }, [live, projectId, onEvents]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col items-start gap-1 rounded-[12px] border border-dashed border-[#D1D5DB] px-4 py-5">
          <span className="text-[14px] font-semibold text-[#111827]">No events yet</span>
          <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#6B7280]">
            Set one up for this project, then come back here to choose it.{" "}
            <LibraryLink projectId={projectId}>Create an event</LibraryLink>
          </p>
        </div>
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 p-0 text-[13px] font-medium text-[#374151]">Event</legend>
        {events.map((event) => {
          const checked = event.id === selectedId;
          const pill = STATUS_PILL[event.status.tone];
          return (
            <label
              key={event.id}
              className="flex cursor-pointer items-center gap-3 rounded-[8px] border border-solid px-3 py-2.5"
              style={{
                borderColor: checked ? ACCENT_LINE : "#E5E7EB",
                background: checked ? ACCENT_WASH : "#FFFFFF",
              }}
            >
              <input
                type="radio"
                name="rt-goalevent"
                checked={checked}
                onChange={() => onSelect(event)}
                className="m-0 size-4 flex-none"
                style={{ accentColor: ACCENT }}
              />
              <span className="flex min-w-0 flex-auto flex-col">
                <span className="text-[14px] leading-5 font-semibold [overflow-wrap:anywhere] text-[#111827]">
                  {event.name}
                </span>
                {event.method ? (
                  <span className="text-[13px] leading-[18px] text-[#6B7280]">
                    {METHOD_LABELS[event.method]}
                  </span>
                ) : null}
              </span>
              <span
                className="inline-flex min-h-6 flex-none items-center rounded-[6px] px-2 text-[12px] font-semibold"
                style={{ background: pill.bg, color: pill.fg }}
              >
                {event.status.label}
              </span>
            </label>
          );
        })}
      </fieldset>
      {error}
      {selected?.status.state === "not_detected" ? (
        <EventWarning>
          Routely hasn’t received this event yet, so test it before launching. You can still save
          and launch.
        </EventWarning>
      ) : null}
      {selected?.status.state === "config_error" ? (
        <EventWarning>{selected.status.note}</EventWarning>
      ) : null}
      <p className="m-0 text-[13px] leading-[18px] text-[#6B7280]">
        Each visitor counts once, however many times the event happens.{" "}
        <LibraryLink projectId={projectId}>Create or configure events</LibraryLink>
      </p>
    </div>
  );
}

function EventWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-3">
      <WarningIcon size={16} className="mt-0.5 flex-none text-[#B45309]" />
      <p className="m-0 text-[13px] leading-[19px] text-pretty text-[#92400E]">{children}</p>
    </div>
  );
}

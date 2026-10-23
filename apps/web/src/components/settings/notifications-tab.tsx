"use client";

import { CheckIcon, Spinner } from "@/components/rt/icons";
import { focusRing } from "@/components/rt/styles";
import { SettingsCard } from "@/components/settings/parts";
import type { AccountNotification } from "@/lib/account";
import { cn } from "@/lib/utils";

export type SaveStatus = "idle" | "saving" | "saved";

/** Email notification switches. Each toggle "saves" on its own, so there is no Save button. */
export function NotificationsTab({
  email,
  items,
  status,
  onToggle,
}: {
  email: string;
  items: AccountNotification[];
  status: SaveStatus;
  onToggle(id: string): void;
}) {
  const text =
    status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Changes save automatically";
  return (
    <SettingsCard
      id="st-notif"
      title="Email notifications"
      description={`Sent to ${email} for every project you can access.`}
      headerClassName="gap-x-4 gap-y-2"
      titleClassName="flex-[1_1_300px]"
      aside={
        <span
          aria-live="polite"
          className="inline-flex h-6 items-center gap-1.5 text-[13px] leading-[19px] text-[#6B7280]"
        >
          {status === "saving" ? <Spinner size={13} /> : null}
          {status === "saved" ? (
            <CheckIcon size={14} strokeWidth={2.4} className="text-[#16A34A]" />
          ) : null}
          {text}
        </span>
      }
    >
      <div className="px-6 pt-2 pb-1.5 max-[641px]:px-4">
        {items.map((n, i) => {
          const labelId = `st-n-${n.id}`;
          return (
            <div
              key={n.id}
              className="flex items-start gap-4 py-4"
              style={{ borderTop: `1px solid ${i === 0 ? "transparent" : "#EEF0F3"}` }}
            >
              <div className="flex min-w-0 flex-auto flex-col gap-0.5">
                <span id={labelId} className="text-sm leading-5 font-semibold text-[#111827]">
                  {n.title}
                </span>
                <span id={`${labelId}-d`} className="text-sm leading-5 text-pretty text-[#4B5563]">
                  {n.desc}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={n.on}
                aria-labelledby={labelId}
                aria-describedby={`${labelId}-d`}
                onClick={() => onToggle(n.id)}
                className={cn(
                  "mt-0.5 inline-flex h-6 w-10 flex-[0_0_40px] cursor-pointer items-center rounded-full border-0 p-0.5 transition-[background] duration-150",
                  focusRing,
                )}
                style={{ background: n.on ? "#0091FF" : "#D1D5DB" }}
              >
                <span
                  aria-hidden
                  className="block size-5 rounded-full bg-white shadow-[0_1px_2px_#11182733] transition-transform duration-150"
                  style={{ transform: n.on ? "translateX(16px)" : "none" }}
                />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF0F3] px-6 py-3.5 max-[641px]:px-4">
        <span className="text-[13px] leading-[19px] text-pretty text-[#6B7280]">
          Routely always emails you about security events, like a new sign-in or a password change.
        </span>
      </div>
    </SettingsCard>
  );
}

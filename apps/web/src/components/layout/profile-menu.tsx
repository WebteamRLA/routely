"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { useShell } from "@/components/layout/shell-context";
import type { ShellUser } from "@/components/layout/types";
import { Avatar, useDismiss } from "@/components/rl";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** Display name: the Google profile name, else the email's local part. */
export function displayName(user: ShellUser): string {
  return user.name?.trim() || user.email.split("@")[0] || user.email;
}

/**
 * The profile button at the foot of the sidebar and the menu it opens upward: name + email,
 * "Team & account" (Settings → Team) and "Log out".
 */
export function ProfileMenu({ user }: { user: ShellUser }) {
  const { current, logout } = useShell();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  const name = displayName(user);

  return (
    <div ref={ref} className="relative border-t border-white/8 pt-2.5">
      {open ? (
        <div className="absolute inset-x-0 bottom-[calc(100%+6px)] z-60 rounded-lg bg-white p-1 text-foreground shadow-[0_14px_36px_rgba(0,0,0,0.35)]">
          <div className="mb-1 min-w-0 border-b border-divider px-2.5 pt-2.5 pb-[9px]">
            <div className="truncate text-[13px] font-extrabold">{name}</div>
            <div className="truncate text-xs text-ink-3">{user.email}</div>
          </div>
          {current ? (
            <Link
              href={routes.project(current.id).settings("team")}
              onClick={close}
              className="block w-full rounded-sm px-2.5 py-[9px] text-left text-[13.5px] font-semibold text-foreground no-underline hover:bg-background hover:text-foreground hover:no-underline"
            >
              Team &amp; account
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => {
              close();
              logout();
            }}
            className="block w-full cursor-pointer rounded-sm border-0 bg-transparent px-2.5 py-[9px] text-left text-[13.5px] font-bold text-danger-text hover:bg-danger-bg"
          >
            Log out
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 p-1.5 text-left text-white outline-none hover:bg-white/7 focus-visible:ring-3 focus-visible:ring-primary/40",
          open ? "bg-white/7" : "bg-transparent",
        )}
      >
        <Avatar name={name} size={30} tone="coral" image={user.image} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold">{name}</span>
          <span className="block truncate text-xs text-white/60">{user.email}</span>
        </span>
        <span aria-hidden className="text-[11px] text-white/60">
          {open ? "▾" : "▴"}
        </span>
      </button>
    </div>
  );
}

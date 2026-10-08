"use client";

import { useEffect, useRef, useState } from "react";

import { SignOutButton } from "@/components/layout/sign-out-button";
import { signOutAction } from "@/server/auth/actions";
import type { SessionUser } from "@/server/auth/session";
import { cn } from "@/lib/utils";

function initials(user: Pick<SessionUser, "name" | "email">): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The profile button at the foot of the sidebar, and the account menu it opens upward: who is
 * signed in, and "Log out". Signing out is a plain form submission to a Server Action, so it
 * works with JavaScript disabled once the menu is open.
 */
export function SidebarAccount({
  user,
  className,
}: {
  user: Pick<SessionUser, "name" | "email" | "image">;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = user.name?.trim() || user.email;

  return (
    <div ref={rootRef} className={cn("relative border-t border-white/8 pt-2.5", className)}>
      {open ? (
        <div className="absolute inset-x-0 bottom-[calc(100%+6px)] z-60 rounded-lg bg-white p-1 text-foreground shadow-[0_14px_36px_rgba(0,0,0,0.35)]">
          <div className="mb-1 min-w-0 border-b border-divider px-2.5 pt-2.5 pb-[9px]">
            <div className="truncate text-[13px] font-extrabold">{name}</div>
            <div className="truncate text-xs text-ink-3">{user.email}</div>
          </div>
          <form action={signOutAction}>
            <SignOutButton />
          </form>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Account menu"
        aria-expanded={open}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left text-white outline-none",
          "hover:bg-white/7 focus-visible:ring-3 focus-visible:ring-primary/40",
          open && "bg-white/7",
        )}
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Google avatar URL; next/image would need the host allow-listed for a 30px picture.
          <img src={user.image} alt="" className="size-[30px] shrink-0 rounded-full object-cover" />
        ) : (
          <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-coral text-xs font-extrabold text-white">
            {initials(user)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold">{name}</span>
          <span className="block truncate text-xs text-white/60">{user.email}</span>
        </span>
        <span aria-hidden className="text-[11px] text-white/60">
          {open ? "▼" : "▲"}
        </span>
      </button>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { ChevronsUpDownIcon } from "@/components/layout/nav-icons";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { CheckIcon, Spinner } from "@/components/rt/icons";
import { AFTER_SIGN_IN } from "@/lib/routes";
import { signOutAction } from "@/server/auth/actions";
import type { SessionUser } from "@/server/auth/session";
import {
  type WorkspaceMenu,
  switchWorkspaceAction,
  workspaceMenuAction,
} from "@/server/actions/team.actions";
import { cn } from "@/lib/utils";

/**
 * The account's picture — the Google profile photo for a Google sign-in — or its initials when
 * there is none (a password account) or the photo will not load.
 */
function AccountAvatar({ user }: { user: Pick<SessionUser, "name" | "email" | "image"> }) {
  const [failed, setFailed] = useState(false);
  const base =
    "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#DBEAFE] text-xs font-semibold text-[#1E40AF]";
  if (user.image && !failed) {
    return (
      // Google's photo host refuses some referrers; a plain <img> also needs no image allow-list.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.image}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(base, "object-cover")}
      />
    );
  }
  return (
    <span aria-hidden className={base}>
      {initials(user)}
    </span>
  );
}

function initials(user: Pick<SessionUser, "name" | "email">): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Who is signed in, pinned to the foot of the sidebar, with "Log out" in a small menu that opens
 * *above* it — the block sits at the bottom of the viewport, so there is no room below.
 *
 * Hand-rolled rather than a Radix `DropdownMenu`: the design anchors the menu to the full width
 * of the account button, which Radix's floating positioning would have to be fought into. The
 * behaviour a menu owes its user is small enough to own here — close on an outside click, close
 * on Escape and hand focus back to the button.
 *
 * "Log out" is still a real form submitting the `signOutAction` Server Action, so signing out
 * never depends on a client-side session library.
 *
 * **Workspace switcher** (not in the design; decision D12). Someone who belongs to more than one
 * workspace — by accepting an invite — sees them listed above "Log out", the current one checked.
 * Picking another makes it current on the server (membership re-checked there) and reloads the
 * dashboard. With a single workspace the menu is exactly the design's. The list is fetched once on
 * mount through a Server Action, so the layout above this component needs no new prop.
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const router = useRouter();
  const [menu, setMenu] = useState<WorkspaceMenu | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    workspaceMenuAction()
      .then((result) => {
        if (live) setMenu(result);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function switchTo(id: string) {
    if (switching || id === menu?.currentId) return;
    setSwitching(id);
    const result = await switchWorkspaceAction(id).catch(() => null);
    if (result?.ok) {
      setMenu((cur) => (cur ? { ...cur, currentId: id } : cur));
      setOpen(false);
      startTransition(() => {
        router.push(AFTER_SIGN_IN);
        router.refresh();
      });
    }
    setSwitching(null);
  }

  const workspaces = menu && menu.workspaces.length > 1 ? menu.workspaces : null;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Stop here so the same keypress does not also close the drawer around this menu.
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative border-t border-[#EEF0F3] pt-3", className)}>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className={cn(
            "absolute right-0 bottom-[calc(100%+6px)] left-0 z-[5] rounded-xl border border-[#E5E7EB] bg-white p-1.5",
            "shadow-[0_12px_32px_#11182724]",
            "animate-in duration-[140ms] ease-out fade-in-0 slide-in-from-top-1 motion-reduce:animate-none",
          )}
        >
          {workspaces ? (
            <div
              role="group"
              aria-label="Workspaces"
              className="mb-1.5 flex flex-col border-b border-[#EEF0F3] pb-1.5"
            >
              <span className="px-2.5 pt-1 pb-1 text-xs leading-4 font-medium text-[#6B7280]">
                Workspaces
              </span>
              {workspaces.map((w) => {
                const current = w.id === menu?.currentId;
                return (
                  <button
                    key={w.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    disabled={!!switching}
                    onClick={() => void switchTo(w.id)}
                    className={cn(
                      "flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-white px-2.5 text-left",
                      "text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]",
                      "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]",
                      "disabled:cursor-default",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    <span className="shrink-0 text-xs text-[#6B7280]">{w.role}</span>
                    <span aria-hidden className="inline-flex size-4 shrink-0 text-[#0070C9]">
                      {switching === w.id ? (
                        <Spinner size={16} />
                      ) : current ? (
                        <CheckIcon size={16} strokeWidth={2.2} />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <form action={signOutAction}>
            <SignOutButton />
          </form>
        </div>
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-[#111827]",
          "hover:shadow-[inset_0_0_0_999px_rgba(17,24,39,.05)]",
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]",
        )}
      >
        <AccountAvatar user={user} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm leading-[18px] font-semibold">
            {user.name ?? "Signed in"}
          </span>
          <span className="truncate text-xs leading-4 text-[#6B7280]">{user.email}</span>
        </span>
        <ChevronsUpDownIcon className="shrink-0 stroke-[#6B7280]" />
      </button>
    </div>
  );
}

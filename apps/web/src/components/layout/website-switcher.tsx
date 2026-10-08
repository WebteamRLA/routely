"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AddWebsiteDialog } from "@/components/websites/add-website-dialog";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export interface SwitcherWebsite {
  id: string;
  name: string;
  domain: string;
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * The design's project switcher, adapted to this app's model.
 *
 * Routely has no "current website" that scopes the whole dashboard — the experiment list and
 * the overview already span every website. So the box shows the account's websites as a whole,
 * and the menu is a jump list: the website whose page is open is marked current, every other
 * one links to its page, and "Add website" opens the same dialog the dashboard uses.
 */
export function WebsiteSwitcher({
  websites,
  onNavigate,
}: {
  websites: SwitcherWebsite[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = websites.find((website) => pathname === routes.websites.detail(website.id));
  const others = websites.filter((website) => website !== current);

  // Outside click and Escape close the menu, as the design's backdrop does.
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

  const title = current?.name ?? "All websites";
  const subtitle =
    current?.domain ??
    (websites.length === 0
      ? "No websites yet"
      : `${websites.length} website${websites.length === 1 ? "" : "s"}`);

  function follow() {
    setOpen(false);
    onNavigate?.();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Switch website"
        aria-expanded={open}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-white/10 px-3 py-2.5 text-left text-white",
          "outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-primary/40",
          open ? "bg-white/10" : "bg-white/5",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white font-heading text-[13px] font-bold text-navy">
          {current ? initial(current.name) : websites.length}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold">{title}</span>
          <span className="block truncate font-mono text-[11px] text-white/60">{subtitle}</span>
        </span>
        <span aria-hidden className="shrink-0 text-[10px] text-white/60">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-60 max-h-[calc(100vh-140px)] animate-rl-in overflow-y-auto rounded-lg bg-white p-1.5 text-foreground shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
          {current ? (
            <>
              <MenuLabel>Current website</MenuLabel>
              <div className="flex items-center gap-2.5 rounded-md bg-brand-tint px-2.5 py-2">
                <Tile website={current} tone="navy" />
                <WebsiteText website={current} strong />
                <span className="shrink-0 font-black text-primary">✓</span>
              </div>
            </>
          ) : null}

          {others.length > 0 ? (
            <>
              <MenuLabel>{current ? "Other websites" : "Websites"}</MenuLabel>
              {others.map((website) => (
                <Link
                  key={website.id}
                  href={routes.websites.detail(website.id)}
                  onClick={follow}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-foreground no-underline hover:bg-muted hover:text-foreground hover:no-underline"
                >
                  <Tile website={website} tone="light" />
                  <WebsiteText website={website} />
                </Link>
              ))}
            </>
          ) : null}

          <div className="mx-1 my-1.5 h-px bg-divider" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setAdding(true);
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-[9px] text-left text-[13.5px] font-extrabold text-primary hover:bg-brand-tint"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md border-[1.5px] border-dashed border-[#B9C6EE] text-base">
              +
            </span>
            Add website
          </button>
          <Link
            href={routes.getStarted}
            onClick={follow}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-[9px] text-[13.5px] font-bold text-ink-2 no-underline hover:bg-muted hover:text-foreground hover:no-underline"
          >
            <span className="grid size-7 shrink-0 place-items-center text-ink-3">⋯</span>
            Manage websites
          </Link>
        </div>
      ) : null}

      <AddWebsiteDialog trigger={null} open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pt-2 pb-1.5 text-[10.5px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">
      {children}
    </div>
  );
}

function Tile({ website, tone }: { website: SwitcherWebsite; tone: "navy" | "light" }) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md font-heading text-[13px] font-bold",
        tone === "navy" ? "bg-navy text-white" : "bg-divider text-navy",
      )}
    >
      {initial(website.name)}
    </span>
  );
}

function WebsiteText({ website, strong }: { website: SwitcherWebsite; strong?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={cn("block truncate text-[13px]", strong ? "font-extrabold" : "font-bold")}>
        {website.name}
      </span>
      <span className="block truncate font-mono text-[11.5px] text-ink-3">{website.domain}</span>
    </span>
  );
}

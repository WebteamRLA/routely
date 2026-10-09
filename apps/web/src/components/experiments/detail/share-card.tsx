"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Section, Spinner } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { setSharingAction } from "@/server/actions/experiment.actions";

/**
 * Public read-only results link (`/share/<token>`): create, replace (old link stops working)
 * or turn off. Not in the design prototype — kept from the existing product, styled as a
 * Setup-tab card.
 */
export function ShareCard({
  projectId,
  experimentId,
  url,
}: {
  projectId: string;
  experimentId: string;
  url: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"enable" | "rotate" | "disable" | null>(null);

  function run(mode: "enable" | "rotate" | "disable") {
    setBusy(mode);
    startTransition(async () => {
      const r = await setSharingAction({ projectId, experimentId, mode });
      setBusy(null);
      if (r.status === "error") return void toast.error(r.message);
      toast(r.message ?? "Saved");
      router.refresh();
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await Promise.race([
        navigator.clipboard.writeText(url),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    } catch {
      // Clipboard can be blocked; the link is still selectable in the field.
    }
    toast("Copied to clipboard");
  }

  return (
    <Section className="flex flex-col gap-3 px-5 py-4">
      <div>
        <div className="text-[12px] font-extrabold tracking-[0.06em] text-ink-3">SHARE RESULTS</div>
        <p className="mt-1 max-w-[680px] text-[13.5px] text-pretty text-ink-2">
          Create a read-only link so someone can see this experiment’s results without a Routely
          account. It shows only this experiment — not your other tests, projects or account.
        </p>
      </div>
      {url ? (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              readOnly
              value={url}
              aria-label="Share link"
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 min-w-0 flex-[1_1_320px] rounded-md border border-input bg-subtle px-3 font-mono text-[12.5px] outline-none focus:border-brand focus:ring-3 focus:ring-primary/15"
            />
            <Button size="sm" className="h-9" onClick={copy}>
              Copy link
            </Button>
          </div>
          <p className="text-[12.5px] text-ink-3">
            Anyone with this link can view the results. It is unguessable, but it is not a password
            — treat it as public once you have sent it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => run("rotate")} disabled={pending}>
              {busy === "rotate" ? <Spinner size={12} /> : null}
              Replace link
            </Button>
            <Button
              variant="destructive-outline"
              size="sm"
              onClick={() => run("disable")}
              disabled={pending}
            >
              {busy === "disable" ? <Spinner size={12} /> : null}
              Stop sharing
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button size="sm" className="h-9" onClick={() => run("enable")} disabled={pending}>
            {busy === "enable" ? <Spinner size={12} onBlue /> : null}
            Create share link
          </Button>
        </div>
      )}
    </Section>
  );
}

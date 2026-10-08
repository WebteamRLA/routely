"use client";

import { useActionState } from "react";
import { useFormToast } from "@/hooks/use-form-toast";
import { Link2, Loader2, RefreshCw, X } from "lucide-react";

import { CopyValue } from "@/components/websites/copy-value";
import { Button } from "@/components/ui/button";
import { IDLE, type FormState } from "@/lib/form-state";

/**
 * Controls for the public results link.
 *
 * The three actions are kept distinct because they answer different questions: create one,
 * "this link got out, give me a new one", and "stop sharing entirely". Collapsing rotate and
 * disable into a single toggle would make the first case require two steps and a moment where
 * nothing is shared.
 */
export function SharePanel({
  experimentId,
  shareUrl,
  enable,
  rotate,
  disable,
}: {
  experimentId: string;
  /** The full public URL, or null when sharing is off. */
  shareUrl: string | null;
  enable: (state: FormState, formData: FormData) => Promise<FormState>;
  rotate: (state: FormState, formData: FormData) => Promise<FormState>;
  disable: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [enableState, enableAction, enabling] = useActionState(enable, IDLE);
  const [rotateState, rotateAction, rotating] = useActionState(rotate, IDLE);
  const [disableState, disableAction, disabling] = useActionState(disable, IDLE);

  // Toasted individually rather than through the derived `state` below: that picks the first
  // non-idle result in a fixed order, so once one action had run the other two could never
  // announce their own outcome.
  useFormToast(enableState);
  useFormToast(rotateState);
  useFormToast(disableState);

  const busy = enabling || rotating || disabling;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-heading text-[15px] font-bold tracking-[-0.01em]">Share results</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-pretty text-ink-3">
          Create a read-only link so someone can see this experiment&rsquo;s numbers without a
          Routely account. It shows only this experiment — not your other tests, websites or
          account.
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        {shareUrl ? (
          <>
            <CopyValue value={shareUrl} label="Copy share link" />
            <p className="text-[12.5px] text-ink-3">
              Anyone with this link can view the results. It is unguessable, but it is not a
              password — treat it as public once you have sent it.
            </p>

            <div className="flex flex-wrap gap-2">
              <form action={rotateAction}>
                <input type="hidden" name="experimentId" value={experimentId} />
                <Button type="submit" variant="outline" size="sm" disabled={busy}>
                  {rotating ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw aria-hidden />
                  )}
                  Replace link
                </Button>
              </form>

              <form action={disableAction}>
                <input type="hidden" name="experimentId" value={experimentId} />
                <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                  {disabling ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
                  Stop sharing
                </Button>
              </form>
            </div>
          </>
        ) : (
          <form action={enableAction}>
            <input type="hidden" name="experimentId" value={experimentId} />
            <Button type="submit" disabled={busy}>
              {enabling ? <Loader2 className="animate-spin" aria-hidden /> : <Link2 aria-hidden />}
              Create share link
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

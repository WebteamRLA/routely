"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { GetStartedGuide } from "@/components/get-started/get-started-guide";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { SiteProtocol } from "@/generated/prisma/enums";
import type { FormState } from "@/lib/form-state";
import type { PixelStatus } from "@/lib/pixel-status";

/**
 * The "Set up Routely" entry point on the dashboard: opens the install panel in a dialog, so
 * fixing "pixel not detected" doesn't require leaving the page it was noticed on.
 *
 * The dialog is a bare frame (no padding, no header of its own) because the panel draws the
 * design's install-modal layout edge to edge, including its title row and sticky footer.
 */
export function PixelSetupDialog({
  website,
  sdkUrl,
  verifyAction,
  triggerLabel = "Set up Routely",
  triggerVariant = "default",
  triggerClassName,
  alreadySetUp,
  pixelStatus,
  verifyUrl,
}: {
  website: {
    id: string;
    name: string;
    domain: string;
    protocol: SiteProtocol;
    publicSiteId: string;
  };
  sdkUrl: string;
  verifyAction: (state: FormState, formData: FormData) => Promise<FormState>;
  /** The websites table reuses this dialog per row, where "Re-check pixel" reads better on a
   * site that is already installed than a generic "Set up Routely". */
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
  /** Lets a caller size the trigger — the websites table gives every row's buttons equal
   * width so the column lines up regardless of which label each row shows. */
  triggerClassName?: string;
  /** True when this website is already set up, so the guide opens on its final step. */
  alreadySetUp?: boolean;
  /** The website's server-resolved status, shown in the panel until a check here replaces it. */
  pixelStatus?: PixelStatus;
  /** Page the Verify step should check, when the caller opened this about a specific one. */
  verifyUrl?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  /**
   * Closes the guide and re-reads the page behind it.
   *
   * The verify action revalidates the Get started path, but this dialog lives in a client
   * component that is already mounted — without an explicit refresh the customer would close
   * it and see the status they came here to change, unchanged.
   */
  function finish() {
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant} className={triggerClassName}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="block max-w-[760px] gap-0 p-0">
        <GetStartedGuide
          website={website}
          sdkUrl={sdkUrl}
          verifyAction={verifyAction}
          verifyUrl={verifyUrl}
          startOnDone={alreadySetUp ?? false}
          pixelStatus={pixelStatus}
          onDone={finish}
        />
      </DialogContent>
    </Dialog>
  );
}

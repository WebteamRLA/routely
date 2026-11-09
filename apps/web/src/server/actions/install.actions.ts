"use server";

import type { VerifyOutcome } from "@/lib/install-verification";
import { type ActionResult, toActionResult } from "@/server/actions/result";
import { requireUser } from "@/server/auth/session";
import * as verificationService from "@/server/services/install-verification.service";

/** The install check, for the tracking dialogs. See `install-verification.service.ts`. */
export async function checkInstallAction(input: unknown): Promise<ActionResult<VerifyOutcome>> {
  return toActionResult(async () => {
    const user = await requireUser();
    return verificationService.checkInstall(user.id, input);
  });
}

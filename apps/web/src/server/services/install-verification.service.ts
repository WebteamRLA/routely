import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { VERIFY_HASH_PARAM } from "@routely/sdk/contract";

import type { Prisma } from "@/generated/prisma/client";
import {
  type BrowserReport,
  type InstallMethodName,
  type StaticLook,
  type VerifyOutcome,
  VERIFY_TOKEN_TTL_MS,
  readVerification,
} from "@/lib/install-verification";
import { can } from "@/lib/permissions";
import { isSameSite } from "@/lib/url";
import { forbidden, notFound, rateLimited, validationFailed } from "@/server/errors";
import { rateLimit } from "@/server/http/rate-limit";
import * as verificationRepo from "@/server/repositories/install-verification.repository";
import * as websiteRepo from "@/server/repositories/website.repository";
import { inspectPage } from "@/server/services/pixel.service";
import { parseOrThrow } from "@/server/validate";
import {
  startVerificationSchema,
  verificationPollSchema,
  verifySignalSchema,
} from "@/validation/custom-event";

/**
 * The install check: did this project's SDK actually run on the customer's page?
 *
 * The server cannot run a page, so the customer's own browser does. The dashboard opens the page
 * with `#_rt_verify=<token>`; the SDK there reports to `/api/v1/verify`; the dashboard polls. The
 * rules that turn those observations into a status live in `lib/install-verification.ts`.
 *
 * The same check serves a pasted tag and a tag in Google Tag Manager. Nothing here signs in to
 * GTM or changes a container.
 */

/** Per user, as the HTML check. A run makes up to five outbound fetches. */
const START_RATE_LIMIT = 10;
const START_RATE_WINDOW_MS = 60_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface StartedVerification {
  id: string;
  /** The page with the token in its fragment: what the dashboard opens. */
  openUrl: string;
  outcome: VerifyOutcome;
}

export async function startVerification(
  actorUserId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<StartedVerification> {
  const { websiteId, url, method } = parseOrThrow(
    startVerificationSchema,
    input,
    "Check the URL you entered.",
  );

  const access = await websiteRepo.findWebsiteAccess(websiteId, actorUserId);
  if (!access) throw notFound("That website does not exist.");
  if (!can(access.role, "pixel.verify")) throw forbidden();
  const { website } = access;

  if (!isSameSite(url, website.domain)) {
    throw validationFailed(
      `Enter a URL on ${website.domain} — that's the domain this website is set up for.`,
      { url: [`Must be a URL on ${website.domain} or one of its subdomains.`] },
    );
  }

  if (!rateLimit(`pixel-verify:${actorUserId}`, START_RATE_LIMIT, START_RATE_WINDOW_MS).allowed) {
    throw rateLimited("Too many checks in a minute. Wait a moment and try again.");
  }

  const { fetched, finding, gtm } = await inspectPage(url, website);
  if (fetched.refused) throw validationFailed(fetched.refused, { url: [fetched.refused] });

  const look: StaticLook = {
    pageLoaded: fetched.pageLoaded,
    loadError: fetched.loadError,
    inHtml: finding.scriptFound && !gtm.inContainer,
    otherInHtml: finding.wrongSiteId,
    containers: gtm.containers,
    inContainer: gtm.inContainer,
    otherInContainer: gtm.otherInContainer,
    containerUnreadable: gtm.unreadable,
  };

  const token = randomBytes(32).toString("base64url");
  const run = await verificationRepo.createVerification({
    websiteId: website.id,
    method,
    url,
    tokenHash: hashToken(token),
    createdById: actorUserId,
    expiresAt: new Date(now.getTime() + VERIFY_TOKEN_TTL_MS),
    staticLook: look as unknown as Prisma.InputJsonObject,
  });

  const open = new URL(fetched.finalUrl || url);
  open.hash = `${VERIFY_HASH_PARAM}=${token}`;

  return {
    id: run.id,
    openUrl: open.href,
    outcome: readVerification(observe(run, look, null, 0, method)),
  };
}

function observe(
  run: {
    loadedAt: Date | null;
    readyAt: Date | null;
    failReason: string | null;
    otherSiteIds: string[];
    tagCount: number | null;
  },
  look: StaticLook | null,
  browser: BrowserReport | null,
  elapsedMs: number,
  method: InstallMethodName,
) {
  return {
    method,
    look,
    loadedAt: run.loadedAt,
    readyAt: run.readyAt,
    failReason: run.failReason,
    otherSiteIds: run.otherSiteIds,
    tagCount: run.tagCount,
    browser,
    elapsedMs,
  };
}

/** Where a run stands. Any member may read it; the run's own website decides that. */
export async function pollVerification(
  actorUserId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<VerifyOutcome> {
  const { id, browser } = parseOrThrow(verificationPollSchema, input);
  const run = await verificationRepo.findForActor(id, actorUserId);
  if (!run) throw notFound("That check has expired. Start it again.");

  return readVerification(
    observe(
      run,
      run.staticLook as unknown as StaticLook | null,
      browser ?? null,
      now.getTime() - run.createdAt.getTime(),
      run.method,
    ),
  );
}

/**
 * The SDK's signal — public, and written to only by holders of a live token.
 *
 * The token says which run this answers; the site ids say what actually ran. The first id is the
 * one the SDK is running as, so a page carrying this project's tag behind another project's is not
 * verified: its data would go to the other project. A signal from a page off the project's domain
 * is ignored, so a token cannot be spent somewhere else to vouch for this site.
 *
 * Repeats are harmless by construction: `loadedAt` and `readyAt` are compare-and-set latches, and
 * only the signal that wins `readyAt` stamps the website.
 */
export async function recordVerifySignal(
  payload: unknown,
  now: Date = new Date(),
): Promise<boolean> {
  const parsed = verifySignalSchema.safeParse(payload);
  if (!parsed.success) return false;
  const { token, stage, reason, siteIds, url, sdk } = parsed.data;

  const run = await verificationRepo.findByTokenHash(hashToken(token));
  if (!run || run.expiresAt.getTime() < now.getTime()) return false;
  if (!isSameSite(url, run.website.domain)) return false;

  const own = run.website.publicSiteId;
  const others = [...new Set(siteIds.filter((id) => id !== own))];
  await verificationRepo.recordPageFacts(run.id, {
    otherSiteIds: others,
    tagCount: siteIds.length,
    sdkVersion: sdk ?? null,
  });

  if (stage === "failed" && reason === "no_site_id") {
    await verificationRepo.recordFailure(run.id, reason);
    return true;
  }

  if (siteIds[0] !== own) return true;

  // Running as this project: a companion from another project becomes a warning, not the verdict.
  if (stage === "failed") {
    await verificationRepo.latchLoaded(run.id, now);
    await verificationRepo.recordFailure(run.id, reason ?? "config");
    return true;
  }

  await verificationRepo.latchLoaded(run.id, now);
  if (stage === "ready" && (await verificationRepo.latchReady(run.id, now))) {
    await verificationRepo.recordInstalled(run.website.id, run.method, now);
  }
  return true;
}

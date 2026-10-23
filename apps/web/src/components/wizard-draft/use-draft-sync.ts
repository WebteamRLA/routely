"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { routes } from "@/lib/routes";
import {
  type ExperimentActionResult,
  createDraftAction,
  saveDraftAction,
} from "@/server/actions/experiment.actions";
import type { DraftSaveResult } from "@/server/services/experiment.service";

/** The design's autosave debounce. */
const SAVE_DELAY_MS = 700;

export interface DraftSyncOptions {
  /** False for the design's mock states and for Viewers: nothing is ever sent. */
  enabled: boolean;
  type: "AB_TEST" | "SPLIT_URL";
  projectId: string;
  /** The draft being edited, or null until the first edit creates one. */
  initialId: string | null;
  /** Stored variant ids the form already uses as its own keys. */
  initialVariantIds: readonly string[];
  /** The whole draft as it stands now. Called at send time, so it sees the latest edits. */
  buildPatch(idFor: (key: string) => string | undefined): unknown;
  /** `pending`: more edits are waiting to be sent. */
  onSaved(data: DraftSaveResult, pending: boolean): void;
  onError(message: string): void;
}

export interface DraftSync {
  /** An edit happened: save it after the debounce. Creates the draft on the first one. */
  schedule(): void;
  /** Sends anything pending now and waits for it. Resolves to the draft id, or null on failure. */
  flush(): Promise<string | null>;
}

/**
 * Autosave for a wizard's draft (spec §3.6): lazy creation on the first edit, a 700 ms debounce,
 * one request at a time, and the whole draft per request — it is small, and sending all of it
 * means a lost request can never leave the stored draft half-updated.
 *
 * Rows the customer adds in the browser have no stored id until the save that creates them
 * returns; the mapping lives here, updated the moment a response arrives, so the next request
 * (which may already be queued) updates those rows instead of creating them twice.
 */
export function useDraftSync(options: DraftSyncOptions): DraftSync {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const draftId = useRef<string | null>(options.initialId);
  const variantIds = useRef<Map<string, string> | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);

  const idMap = useCallback((): Map<string, string> => {
    if (!variantIds.current) {
      variantIds.current = new Map(
        optionsRef.current.initialVariantIds.map((id) => [id, id] as const),
      );
    }
    return variantIds.current;
  }, []);
  const idFor = useCallback((key: string) => idMap().get(key), [idMap]);

  const send = useCallback(async (): Promise<boolean> => {
    while (inflight.current) await inflight.current;
    if (!dirty.current) return true;
    dirty.current = false;

    const request = (async () => {
      const opts = optionsRef.current;
      const patch = opts.buildPatch(idFor);
      let result: ExperimentActionResult<DraftSaveResult>;
      try {
        result = draftId.current
          ? await saveDraftAction(draftId.current, patch)
          : await createDraftAction(opts.type, opts.projectId, patch);
      } catch {
        result = {
          ok: false,
          code: "INTERNAL",
          message: "Check your connection and try again.",
        };
      }

      if (!result.ok) {
        // Kept dirty, so the next edit or an explicit flush tries again.
        dirty.current = true;
        optionsRef.current.onError(result.message);
        return false;
      }

      const created = draftId.current === null;
      draftId.current = result.data.id;
      for (const { key, id } of result.data.variants) idMap().set(key, id);
      if (created) {
        // Reloading resumes this draft instead of starting another.
        window.history.replaceState(
          null,
          "",
          routes.experiments.wizard(optionsRef.current.type, result.data.id),
        );
      }
      optionsRef.current.onSaved(result.data, dirty.current || timer.current !== null);
      return true;
    })();

    inflight.current = request;
    try {
      return await request;
    } finally {
      inflight.current = null;
    }
  }, [idFor, idMap]);

  const schedule = useCallback(() => {
    if (!optionsRef.current.enabled) return;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void send();
    }, SAVE_DELAY_MS);
  }, [send]);

  const flush = useCallback(async (): Promise<string | null> => {
    if (!optionsRef.current.enabled) return draftId.current;
    // A handler that changes state and flushes in the same event (going to step 5 starts the
    // tracking check) must send the state it just set: let React commit it first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const ok = await send();
    return ok ? draftId.current : null;
  }, [send]);

  // Leaving the page within the debounce would drop the last edit: send it on the way out. The
  // request outlives the component, and a Server Action needs no response to have saved.
  useEffect(() => {
    const leave = () => {
      if (dirty.current) void send();
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [send]);

  return useMemo(() => ({ schedule, flush }), [schedule, flush]);
}

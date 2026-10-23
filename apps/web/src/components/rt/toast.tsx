"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { InfoIcon } from "@/components/rt/icons";

export interface ToastMessage {
  title: string;
  note: string;
}

/**
 * The design's single toast: one at a time, bottom-right, gone after 3.4s. A new toast replaces
 * the current one rather than stacking, as in the reference.
 *
 *   const { toast, notify } = useToast();
 *   …
 *   <ToastHost toast={toast} />
 */
export function useToast(duration = 3400) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const notify = useCallback(
    (title: string, note: string) => {
      clearTimeout(timer.current);
      setToast({ title, note });
      timer.current = setTimeout(() => setToast(null), duration);
    },
    [duration],
  );
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  return { toast, notify, dismiss };
}

/**
 * Portaled to `<body>`: the app shell is `position: fixed`, which makes it its own stacking context,
 * so a toast rendered inside it would sit under a dialog's overlay (also portaled, z-80) whatever
 * its own z-index. Rendered only after mount, as a portal needs the DOM.
 */
export function ToastHost({ toast }: { toast: ToastMessage | null }) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed right-5 bottom-4 z-[99] max-[641px]:right-4 max-[641px]:left-4"
    >
      {toast ? (
        <div className="flex w-[440px] max-w-[calc(100vw-32px)] animate-[rt-up_.18s_ease-out] items-start gap-3 rounded-xl border border-[#EEF0F3] bg-white p-4 text-[#111827] shadow-[0_8px_24px_rgba(17,24,39,.12)] max-[641px]:w-full max-[641px]:max-w-none">
          <span
            aria-hidden
            className="inline-flex size-8 flex-none items-center justify-center rounded-lg bg-[#E6F4FF] text-[#0060AD]"
          >
            <InfoIcon />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5 pt-px">
            <span className="text-sm leading-5 font-semibold text-[#111827]">{toast.title}</span>
            <span className="text-[13px] leading-5 text-[#6B7280]">{toast.note}</span>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

const noopSubscribe = () => () => {};

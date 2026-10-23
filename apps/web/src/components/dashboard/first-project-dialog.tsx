"use client";

import { Dialog as DialogPrimitive } from "radix-ui";

import { AlertCircleIcon, Spinner, XIcon } from "@/components/rt/icons";
import { Modal } from "@/components/rt/modal";
import { btn, errorText, help, input, label } from "@/components/rt/styles";
import { firstProjectErrors } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

export interface FirstProjectForm {
  name: string;
  url: string;
  /** Errors show only once a submit has been tried. */
  attempted: boolean;
  busy: boolean;
  failed: boolean;
  /** The server's field messages for the last submission (e.g. a name taken a moment ago). */
  serverErrors?: { name?: string; url?: string };
  /** A non-field refusal worth showing as is (no permission); otherwise the design's copy. */
  failure?: string;
}

/**
 * "Add your first project" — the Dashboard's onboarding form for an account with no projects.
 *
 * The header is rendered here rather than by `Modal` because the reference disables its close
 * button while the project is being created, which the shared header does not do.
 */
export function FirstProjectDialog({
  form,
  onChange,
  onClose,
  onSubmit,
}: {
  form: FirstProjectForm | null;
  onChange(form: FirstProjectForm): void;
  onClose(): void;
  onSubmit(form: FirstProjectForm): void;
}) {
  const f = form ?? { name: "", url: "", attempted: false, busy: false, failed: false };
  const local = firstProjectErrors(f);
  const errs = {
    name: f.serverErrors?.name || local.name,
    url: f.serverErrors?.url || local.url,
  };
  const show = f.attempted && !f.busy;
  const nameErr = show ? errs.name : "";
  const urlErr = show ? errs.url : "";

  const submit = () => {
    if (f.busy) return;
    if (errs.name || errs.url) {
      onChange({ ...f, attempted: true, failed: false });
      return;
    }
    onSubmit(f);
  };

  return (
    <Modal
      open={form !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title={null}
      busy={f.busy}
      width={520}
    >
      <div className="flex items-start gap-3 px-6 pt-5 max-[641px]:px-4">
        <div className="flex min-w-0 flex-auto flex-col gap-1">
          <DialogPrimitive.Title className="m-0 text-base leading-6 font-semibold text-[#111827]">
            Add your first project
          </DialogPrimitive.Title>
          <p className="m-0 text-sm leading-5 text-pretty text-[#4B5563]">
            Add the website you want to test. You’ll install its tracking script from the dashboard
            next.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={f.busy}
          className={btn.icon}
        >
          <XIcon />
        </button>
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-4 px-6 py-5 max-[641px]:px-4">
          {f.failed && !f.busy ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-3"
            >
              <AlertCircleIcon strokeWidth={1.8} className="mt-px flex-none text-[#B91C1C]" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm leading-[19px] font-semibold text-[#B91C1C]">
                  We couldn’t create the project
                </span>
                <span className="text-[13px] leading-[19px] text-pretty text-[#B91C1C]">
                  {f.failure ??
                    "Something went wrong on our side. Your details are still here, so try again in a moment."}
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="rt-fp-name" className={label}>
              Project name
            </label>
            <input
              id="rt-fp-name"
              type="text"
              value={f.name}
              onChange={(e) =>
                onChange({
                  ...f,
                  name: e.target.value,
                  failed: false,
                  serverErrors: { ...f.serverErrors, name: undefined },
                })
              }
              disabled={f.busy}
              placeholder="e.g. Fernwood Supply"
              aria-invalid={nameErr ? true : false}
              aria-describedby="rt-fp-name-help"
              maxLength={60}
              autoComplete="off"
              className={cn(input, "h-11 disabled:opacity-100")}
            />
            {nameErr ? (
              <p id="rt-fp-name-help" role="alert" className={errorText}>
                {nameErr}
              </p>
            ) : (
              <p id="rt-fp-name-help" className={help}>
                Usually your site or brand name. Shown on the Projects page and in reports.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="rt-fp-url" className={label}>
              Website address
            </label>
            <input
              id="rt-fp-url"
              type="text"
              inputMode="url"
              value={f.url}
              onChange={(e) =>
                onChange({
                  ...f,
                  url: e.target.value,
                  failed: false,
                  serverErrors: { ...f.serverErrors, url: undefined },
                })
              }
              disabled={f.busy}
              placeholder="example.com"
              aria-invalid={urlErr ? true : false}
              aria-describedby="rt-fp-url-help"
              maxLength={200}
              autoComplete="off"
              className={cn(input, "h-11 disabled:opacity-100")}
            />
            {urlErr ? (
              <p id="rt-fp-url-help" role="alert" className={errorText}>
                {urlErr}
              </p>
            ) : (
              <p id="rt-fp-url-help" className={help}>
                The site where you’ll run experiments, like example.com or shop.example.com.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-[#EEF0F3] px-6 py-4 max-[641px]:px-4">
          <div className="flex flex-wrap gap-2 max-[641px]:w-full max-[641px]:[&>*]:h-11 max-[641px]:[&>*]:flex-auto">
            <button type="button" onClick={onClose} disabled={f.busy} className={btn.secondary}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={f.busy}
              aria-busy={f.busy}
              className={cn(btn.primary, "shadow-none")}
            >
              {f.busy ? <Spinner /> : null}
              {f.busy ? "Adding project…" : "Add project"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

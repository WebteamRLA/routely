"use client";

import { Spinner } from "@/components/rt/icons";
import { Modal, ModalBody, ModalFooter } from "@/components/rt/modal";
import { ACCENT, ACCENT_WASH, errorText, help, input } from "@/components/rt/styles";
import { sbtn } from "@/components/settings/parts";
import {
  ASSIGNABLE_ROLES,
  inviteErrors,
  parseInviteEmails,
  validEmail,
  type AssignableRoleLabel,
} from "@/lib/team";
import { cn } from "@/lib/utils";

export interface InviteForm {
  emails: string;
  role: AssignableRoleLabel;
  attempted: boolean;
  busy: boolean;
  /** Messages the server returned for the last submission (a race the dialog could not see). */
  serverErrors?: string[];
}

export const EMPTY_INVITE: InviteForm = {
  emails: "",
  role: "Editor",
  attempted: false,
  busy: false,
};

/**
 * "Invite team members". Validates as the user types with the same rules and messages as
 * `team.service.inviteMembers` (`lib/team.ts`); the server re-checks against the database, and any
 * message it returns that the dialog could not foresee is shown in the same place.
 */
export function InviteDialog({
  open,
  form,
  workspaceName,
  memberEmails,
  pendingEmails,
  onChange,
  onClose,
  onSend,
}: {
  open: boolean;
  form: InviteForm;
  workspaceName: string;
  /** Lower-cased addresses already on the team. */
  memberEmails: readonly string[];
  /** Lower-cased addresses holding a live (unexpired) invite. */
  pendingEmails: readonly string[];
  onChange(patch: Partial<InviteForm>): void;
  onClose(): void;
  onSend(): void;
}) {
  const local = inviteErrors(form.emails, memberEmails, pendingEmails);
  const errs = local.length ? local : (form.serverErrors ?? []);
  const showErr = form.attempted && errs.length > 0;
  const valid = parseInviteEmails(form.emails).filter(validEmail).length;
  const sendLabel = form.busy ? "Sending…" : valid > 1 ? `Send ${valid} invites` : "Send invite";

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      busy={form.busy}
      width={540}
      title="Invite team members"
      description={`They’ll get an email invite to join ${workspaceName}. Invites expire after 7 days.`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="contents"
      >
        <ModalBody className="gap-[18px]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="st-inv-emails" className="text-[13px] font-medium text-[#374151]">
              Email addresses
            </label>
            <input
              id="st-inv-emails"
              type="text"
              value={form.emails}
              onChange={(e) => onChange({ emails: e.target.value, serverErrors: undefined })}
              disabled={form.busy}
              placeholder="name@company.com, another@company.com"
              autoComplete="off"
              aria-invalid={showErr}
              aria-describedby="st-inv-help"
              className={cn(input, "max-[641px]:h-11")}
            />
            {showErr ? (
              <div id="st-inv-help" role="alert" className="flex flex-col gap-0.5">
                {errs.map((t) => (
                  <p key={t} className={cn(errorText, "[overflow-wrap:anywhere]")}>
                    {t}
                  </p>
                ))}
              </div>
            ) : (
              <p id="st-inv-help" className={help}>
                Separate addresses with commas. Up to 10 at a time.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span id="st-inv-role" className="text-[14px] font-semibold text-[#374151]">
              Role
            </span>
            <div role="radiogroup" aria-labelledby="st-inv-role" className="flex flex-col gap-2">
              {ASSIGNABLE_ROLES.map((r) => {
                const sel = r.label === form.role;
                return (
                  <button
                    key={r.label}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    onClick={() => onChange({ role: r.label })}
                    disabled={form.busy}
                    className="flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left text-[#111827] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF] hover:enabled:!border-[#B3DBFF] disabled:cursor-default disabled:opacity-45"
                    style={{
                      borderColor: sel ? ACCENT : "#E5E7EB",
                      background: sel ? ACCENT_WASH : "#FFFFFF",
                    }}
                  >
                    <span
                      aria-hidden
                      className="mt-px inline-flex size-[18px] flex-[0_0_18px] items-center justify-center rounded-full border-[1.5px] bg-white"
                      style={{ borderColor: sel ? ACCENT : "#D1D5DB" }}
                    >
                      <span
                        className="block size-2 rounded-full"
                        style={{ background: sel ? ACCENT : "transparent" }}
                      />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm leading-5 font-semibold">{r.label}</span>
                      <span className="text-[13px] leading-[19px] text-[#4B5563]">{r.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button type="button" onClick={onClose} disabled={form.busy} className={sbtn.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={form.busy} className={sbtn.primary}>
            {form.busy ? <Spinner /> : null}
            {sendLabel}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

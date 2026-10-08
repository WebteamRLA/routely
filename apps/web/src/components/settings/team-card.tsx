"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Banner, CardTitle, Section, SelectInput, TextInput } from "@/components/rl";
import { Button } from "@/components/ui/button";
import type { MemberView } from "@/lib/view-models";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
} from "@/server/actions/project.actions";

type Role = "Editor" | "Viewer";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Settings → Team (DESIGN.md 2.7). A SERVICE SEAM: member rows are stored and listed, but grant no
 * access and no email is sent — said plainly in the preview note so nobody relies on it.
 */
export function TeamCard({ projectId, members }: { projectId: string; members: MemberView[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Editor");
  const [error, setError] = useState("");
  const [inviting, startInvite] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function invite() {
    const v = email.trim();
    if (!EMAIL_RE.test(v)) return setError("Enter a valid email address.");
    if (members.some((m) => m.email.toLowerCase() === v.toLowerCase()))
      return setError("Already a member.");
    startInvite(async () => {
      const result = await inviteMemberAction({ projectId, email: v, role });
      if (result.status === "error") {
        setError(result.fieldErrors?.["email"]?.[0] ?? result.message);
        return;
      }
      setEmail("");
      // No email is sent (seam), so not the prototype's "Invitation sent".
      toast(result.message ?? `Invitation saved for ${v}`);
      router.refresh();
    });
  }

  async function changeRole(member: MemberView, next: Role) {
    if (!member.id) return;
    setBusy(member.id);
    const result = await changeMemberRoleAction({ projectId, memberId: member.id, role: next });
    setBusy(null);
    if (result.status === "error") return void toast(result.message);
    toast(`${member.name} is now ${next}`);
    router.refresh();
  }

  async function remove(member: MemberView) {
    if (!member.id) return;
    setBusy(member.id);
    const result = await removeMemberAction({ projectId, memberId: member.id });
    setBusy(null);
    if (result.status === "error") return void toast(result.message);
    toast(`${member.name} removed`);
    router.refresh();
  }

  return (
    <Section clip>
      <div className="border-b border-divider px-5 py-[18px]">
        <CardTitle size={15.5}>Team</CardTitle>
        <p className="mt-1 text-[13px] text-ink-3">
          Editors can create and launch experiments. Viewers can see results only.
        </p>
      </div>
      <div className="border-b border-divider px-5 py-3">
        <Banner tone="warning">
          Preview: invited members don’t get access yet. Invitations are saved to this list, but no
          email is sent and nobody else can sign in to this project until team access ships.
        </Banner>
      </div>
      <ul className="m-0 list-none p-0">
        {members.map((m) => (
          <li
            key={m.id ?? "owner"}
            className="flex flex-wrap items-center gap-3 border-b border-divider px-5 py-3"
          >
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-navy text-xs font-extrabold text-white"
            >
              {m.initials}
            </span>
            <div className="min-w-[160px] flex-1">
              <div className="font-extrabold">
                {m.name}
                {m.invited ? (
                  <span className="ml-2 text-[11.5px] font-bold text-ink-3">Invited</span>
                ) : null}
              </div>
              <div className="text-[12.5px] break-all text-ink-3">{m.email}</div>
            </div>
            {m.isOwner ? (
              <span className="text-[12.5px] font-extrabold text-ink-2">Owner</span>
            ) : (
              <div className="flex items-center gap-2">
                <SelectInput
                  aria-label={`Role for ${m.name}`}
                  inputSize="sm"
                  className="h-[34px] w-auto text-[13px]"
                  value={m.role}
                  disabled={busy === m.id}
                  onChange={(e) => changeRole(m, e.target.value as Role)}
                >
                  <option value="Editor">Editor</option>
                  <option value="Viewer">Viewer</option>
                </SelectInput>
                <button
                  type="button"
                  onClick={() => remove(m)}
                  disabled={busy === m.id}
                  className="cursor-pointer border-0 bg-transparent text-[12.5px] font-bold text-danger-text hover:underline disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form
        noValidate
        className="flex flex-wrap gap-2 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          invite();
        }}
      >
        <TextInput
          aria-label="Invite by email"
          type="email"
          inputSize="md"
          className="h-[38px] flex-[1_1_220px]"
          placeholder="name@company.com"
          value={email}
          invalid={!!error}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
        />
        <SelectInput
          aria-label="Role for the invite"
          inputSize="md"
          className="h-[38px] w-auto text-[13px]"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="Editor">Editor</option>
          <option value="Viewer">Viewer</option>
        </SelectInput>
        <Button type="submit" disabled={inviting}>
          {inviting ? "Sending…" : "Send invite"}
        </Button>
      </form>
      {error ? (
        <div role="alert" className="px-5 pb-3.5 text-[12.5px] font-semibold text-danger-text">
          {error}
        </div>
      ) : null}
    </Section>
  );
}

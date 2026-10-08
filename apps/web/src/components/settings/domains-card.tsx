"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CardTitle, FieldError, Section, Tag, TextInput } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { addDomainAction, removeDomainAction } from "@/server/actions/project.actions";

/**
 * Settings → Project → "Domains". The primary domain is fixed here (it changes through the
 * project modal); additional domains are added and removed with the real domain actions, which
 * validate, normalise and refuse duplicates or domains another project uses.
 */
export function DomainsCard({ projectId, domains }: { projectId: string; domains: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [adding, startAdd] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  function add() {
    if (!value.trim()) {
      setError("Enter a domain like shop.example.com");
      return;
    }
    startAdd(async () => {
      const result = await addDomainAction({ projectId, domain: value });
      if (result.status === "error") {
        setError(result.fieldErrors?.["domain"]?.[0] ?? result.message);
        return;
      }
      const added = result.data.find((d) => !domains.includes(d)) ?? value.trim();
      setValue("");
      toast(`${added} added · install the snippet there too`);
      router.refresh();
    });
  }

  async function remove(domain: string) {
    setRemoving(domain);
    const result = await removeDomainAction({ projectId, domain });
    setRemoving(null);
    if (result.status === "error") {
      toast(result.message);
      return;
    }
    toast(result.message ?? `${domain} removed`);
    router.refresh();
  }

  return (
    <Section padded className="gap-3">
      <CardTitle size={15.5}>Domains</CardTitle>
      <p className="text-[13px] text-ink-3">
        Experiments can only run, and conversions can only be attributed, on these domains.
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {domains.map((domain, i) => (
          <li
            key={domain}
            className="flex items-center gap-2.5 rounded-lg border border-divider px-3 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{domain}</span>
            {i === 0 ? (
              <Tag tone="blue" className="text-[11px]">
                Primary
              </Tag>
            ) : (
              <button
                type="button"
                onClick={() => remove(domain)}
                disabled={removing === domain}
                aria-label={`Remove ${domain}`}
                className="cursor-pointer border-0 bg-transparent text-[12.5px] font-bold text-danger-text hover:underline disabled:cursor-wait disabled:opacity-60"
              >
                {removing === domain ? "Removing…" : "Remove"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <TextInput
          aria-label="New domain"
          inputSize="md"
          mono
          className="h-[38px] flex-[1_1_220px]"
          placeholder="shop.example.com"
          value={value}
          invalid={!!error}
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
        />
        <Button type="submit" variant="outline" disabled={adding}>
          {adding ? "Adding…" : "Add domain"}
        </Button>
      </form>
      <FieldError>{error}</FieldError>
    </Section>
  );
}

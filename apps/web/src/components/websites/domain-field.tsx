"use client";

import { useState } from "react";

import { Field } from "@/components/common/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SiteProtocol } from "@/generated/prisma/enums";

/**
 * The scheme + host pair, as one field.
 *
 * The scheme is a stored property of the website rather than a display detail: every URL Routely
 * suggests for a site — the verify step, the experiment URL placeholders — is built from it, so a
 * local `http://` site stops proposing `https://` and making the customer retype it. Storing it
 * separately from `domain` also keeps `domain` a bare host, which is what the same-site rule and
 * the unique constraint both compare against.
 *
 * Shared by the create dialog and the settings form so the two can never drift apart.
 */
export function DomainField({
  defaultProtocol = "HTTPS",
  defaultDomain = "",
  errors,
}: {
  defaultProtocol?: SiteProtocol;
  defaultDomain?: string;
  errors?: string[];
}) {
  const [protocol, setProtocol] = useState<SiteProtocol>(defaultProtocol);

  return (
    <Field
      name="domain"
      label="Domain"
      hint="The scheme is remembered, so every URL we suggest for this site matches it. Pasting a full URL is fine — we keep the host."
      errors={errors}
    >
      {(props) => (
        // The ring is drawn on the wrapper, and suppressed on both children, so the pair reads as
        // a single control on focus rather than two adjacent ones.
        <div className="flex rounded-md focus-within:ring-3 focus-within:ring-primary/15">
          <Select value={protocol} onValueChange={(value) => setProtocol(value as SiteProtocol)}>
            <SelectTrigger
              aria-label="Protocol"
              className="h-auto! w-[6.5rem] shrink-0 cursor-pointer self-stretch rounded-r-none border-r-0 focus-visible:ring-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HTTPS">https://</SelectItem>
              <SelectItem value="HTTP">http://</SelectItem>
            </SelectContent>
          </Select>

          {/* A Radix Select is not a form control, so the value travels in a hidden input. */}
          <input type="hidden" name="protocol" value={protocol} />

          <Input
            {...props}
            defaultValue={defaultDomain}
            placeholder="acme.com"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            className="rounded-l-none focus-visible:ring-0"
          />
        </div>
      )}
    </Field>
  );
}

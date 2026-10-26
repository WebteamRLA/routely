import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

import { authTextLink } from "@/components/auth/styles";
import { LEGAL_OPERATOR, LEGAL_UPDATED } from "@/lib/legal";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/**
 * The Privacy Policy and Terms of Service. The design has no legal pages, so — like the other
 * undesigned account pages (D12) — they borrow the sign-in screen's language: white page, brand
 * lock-up, the same heading, text colours and link style, in a column wide enough to read.
 */

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <div className="min-h-screen bg-white text-[15px] leading-6 text-[#374151] antialiased selection:bg-[#D6ECFF]">
      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-10 px-6 pt-14 pb-10 max-[641px]:gap-8 max-[641px]:px-4 max-[641px]:pt-10">
        <Link
          href={routes.home}
          aria-label="Routely"
          className="inline-flex h-11 items-center gap-2.5 self-start rounded-md text-[#111827] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0091FF]"
        >
          <Image
            src="/routely-mark.png"
            alt=""
            width={39}
            height={44}
            loading="eager"
            unoptimized
            className="block h-11 w-[39px] flex-none"
          />
          <span className="text-[26px] leading-8 font-semibold tracking-[-0.01em]">Routely</span>
        </Link>

        <header className="flex flex-col gap-2">
          <h1 className="m-0 text-[30px] leading-[38px] font-semibold tracking-[-0.02em] text-[#111827] max-[641px]:text-[26px] max-[641px]:leading-[34px]">
            {title}
          </h1>
          <p className="m-0 text-sm text-[#6B7280]">Last updated {LEGAL_UPDATED}</p>
        </header>

        <div className="flex flex-col gap-4 text-pretty">{intro}</div>

        <nav aria-label="Contents" className="rounded-xl border border-[#E5E7EB] px-5 py-4">
          <p className="m-0 mb-2 text-[13px] font-semibold tracking-[0.02em] text-[#6B7280] uppercase">
            Contents
          </p>
          <ol className="m-0 grid list-none gap-x-6 gap-y-1.5 p-0 text-sm sm:grid-cols-2">
            {sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-[#374151] underline decoration-transparent underline-offset-2 hover:text-[#111827] hover:decoration-[#111827]"
                >
                  {index + 1}. {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((section, index) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-title`}
            className="flex scroll-mt-6 flex-col gap-3 text-pretty"
          >
            <h2
              id={`${section.id}-title`}
              className="m-0 text-lg leading-7 font-semibold tracking-[-0.01em] text-[#111827]"
            >
              {index + 1}. {section.title}
            </h2>
            {section.body}
          </section>
        ))}
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[#F3F4F6] px-6 py-5 text-[13px] leading-[18px] text-[#6B7280]">
        <span>© 2026 {LEGAL_OPERATOR}</span>
        <span aria-hidden>·</span>
        <Link href={routes.termsOfService} className={authTextLink}>
          Terms of Service
        </Link>
        <span aria-hidden>·</span>
        <Link href={routes.privacyPolicy} className={authTextLink}>
          Privacy Policy
        </Link>
        <span aria-hidden>·</span>
        <Link href={routes.login} className={authTextLink}>
          Sign in
        </Link>
      </footer>
    </div>
  );
}

/** A paragraph of policy text. */
export function P({ children }: { children: ReactNode }) {
  return <p className="m-0">{children}</p>;
}

/** A sub-heading inside a section. */
export function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="m-0 mt-2 text-[15px] leading-6 font-semibold text-[#111827]">{children}</h3>
  );
}

/** A bulleted list. */
export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 marker:text-[#9CA3AF]">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** A small table. Its cells wrap on a phone rather than scrolling, so no column is ever cut off. */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div>
      <table className="w-full border-collapse text-sm leading-5 max-[641px]:text-[13px]">
        <thead>
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="border-b border-[#E5E7EB] py-2 pr-4 text-left font-semibold text-[#111827] last:pr-0 max-[641px]:pr-3"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={cn(
                    "border-b border-[#F3F4F6] py-2 pr-4 align-top [overflow-wrap:anywhere] last:pr-0 max-[641px]:pr-3",
                    c === 0 && "font-medium text-[#111827]",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Inline code, for cookie and storage key names. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-[#F3F4F6] px-1 py-0.5 font-mono text-[13px] text-[#111827]">
      {children}
    </code>
  );
}

/** How to reach the operator: `SUPPORT_EMAIL` when configured. */
export function ContactLine({ email }: { email: string | null }) {
  return email ? (
    <a href={`mailto:${email}`} className={authTextLink}>
      {email}
    </a>
  ) : (
    <>the support address on the Routely sign-in page</>
  );
}

import Link from "next/link";

import { CardTitle, Section } from "@/components/rl";
import { ATTENTION_TAG, type AttentionItem } from "@/components/dashboard/model";

/** "Needs a decision": at most three items, tag chip + title + body + action link. */
export function NeedsDecision({ items, count }: { items: AttentionItem[]; count: string }) {
  if (!items.length) return null;
  return (
    <Section clip>
      <div className="flex items-baseline justify-between gap-2.5 border-b border-border px-5 py-4">
        <CardTitle size={15}>Needs a decision</CardTitle>
        <span className="text-[12.5px] text-ink-3">{count}</span>
      </div>
      {items.map((a, i) => {
        const tag = ATTENTION_TAG[a.tag];
        return (
          <div
            key={`${a.tag}-${i}`}
            className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-divider px-5 py-3.5"
          >
            <span
              className="min-w-24 shrink-0 rounded-sm px-[7px] py-[3px] text-center text-[10.5px] font-extrabold tracking-[0.06em] uppercase"
              style={{ background: tag.bg, color: tag.color }}
            >
              {a.tag}
            </span>
            <div className="min-w-0 flex-[1_1_320px]">
              <div className="text-[13.5px] font-bold">{a.title}</div>
              <div className="mt-0.5 text-[12.5px] text-pretty text-ink-3">{a.body}</div>
            </div>
            <Link href={a.href} className="text-[13px] font-bold whitespace-nowrap">
              {a.action} →
            </Link>
          </div>
        );
      })}
    </Section>
  );
}

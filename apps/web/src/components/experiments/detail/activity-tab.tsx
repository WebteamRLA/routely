import { Diamond, Section } from "@/components/rl";

export interface ActivityRow {
  id: string;
  when: string;
  text: string;
  who: string;
}

/** Activity timeline, newest first, with coral diamonds (prototype L1567–1577). */
export function ActivityTab({ rows }: { rows: ActivityRow[] }) {
  return (
    <Section className="px-5 py-2">
      {rows.length === 0 ? (
        <div className="py-3.5 text-[13.5px] text-ink-3">No activity recorded yet.</div>
      ) : (
        rows.map((l) => (
          <div
            key={l.id}
            className="flex items-baseline gap-3.5 border-b border-divider py-3.5 last:border-b-0"
          >
            <span className="min-w-16 text-[12.5px] font-bold text-ink-3">{l.when}</span>
            <Diamond className="relative -top-px" />
            <div>
              <div className="text-[13.5px] font-bold">{l.text}</div>
              <div className="text-[12.5px] text-ink-3">{l.who}</div>
            </div>
          </div>
        ))
      )}
    </Section>
  );
}

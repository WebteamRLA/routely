import type { Inline, Text } from "@/lib/guides-types";

/** Guide text: plain runs, `code` and bold — never HTML. Usable from server and client components. */
export function Rich({ text }: { text: Text }) {
  if (typeof text === "string") return <>{text}</>;
  return (
    <>
      {text.map((part: Inline, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : "code" in part ? (
          <code
            key={i}
            className="rounded bg-[#F3F4F6] px-1 py-px font-mono text-[0.92em] [overflow-wrap:anywhere] text-[#111827]"
          >
            {part.code}
          </code>
        ) : (
          <strong key={i} className="font-semibold text-[#111827]">
            {part.strong}
          </strong>
        ),
      )}
    </>
  );
}

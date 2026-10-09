import type { IconProbe } from "@/components/projects/use-favicon-probe";
import { Spinner } from "@/components/rl";
import { isValidDomain, normDomain } from "@/lib/domain-normalize";

const STATUS = {
  idle: ["Enter your website URL to detect its icon", "#8A93A6"],
  loading: ["", "#2B59F0"],
  ok: ["Site icon found · used as the project icon", "#0F7A52"],
  fail: ["No site icon found · using a generated icon", "#94600A"],
} as const;

/** "Project icon · detected from your website" (DESIGN.md §3.2). */
export function ProjectIconPreview({
  probe,
  name,
  url,
}: {
  probe: IconProbe;
  name: string;
  url: string;
}) {
  const dm = normDomain(url);
  const okDomain = isValidDomain(dm);
  // A probe for an older value of the field counts as idle.
  const state = okDomain && probe.status !== "idle" && probe.domain === dm ? probe.status : "idle";
  const showImg = state === "ok" && probe.status === "ok";
  const [text, color] = STATUS[state];
  const letter = ((name || dm || "?").trim()[0] ?? "?").toUpperCase();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-extrabold">
        Project icon <span className="font-medium text-ink-3">· detected from your website</span>
      </span>
      <div className="flex items-center gap-3.5 rounded-lg border border-border bg-subtle px-3.5 py-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border font-heading text-[19px] font-bold text-white"
          style={{
            background: showImg || state === "loading" ? "#FFFFFF" : "#0A1633",
            borderColor: showImg || state === "loading" ? "#E4E7EE" : "#0A1633",
          }}
        >
          {state === "loading" ? (
            <Spinner size={18} />
          ) : showImg ? (
            <span
              role="img"
              aria-label="Site icon"
              className="block size-full bg-center bg-no-repeat"
              style={{
                backgroundImage: `url(${JSON.stringify(probe.src)})`,
                backgroundSize: "72%",
              }}
            />
          ) : (
            letter
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-extrabold">
            {name.trim() || "Untitled project"}
          </div>
          <div className="truncate font-mono text-[12px] text-ink-3">
            {okDomain ? dm : "no website yet"}
          </div>
          <div
            className="mt-[3px] flex items-center gap-1.5 text-[12px] font-bold"
            style={{ color }}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
            {state === "loading" ? `Looking for a site icon on ${dm}…` : text}
          </div>
        </div>
      </div>
    </div>
  );
}

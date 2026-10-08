import { CodeBlock } from "@/components/common/code-block";
import { CopyValue } from "@/components/websites/copy-value";
import { buildInstallSnippet } from "@/lib/snippet";
import { cn } from "@/lib/utils";

/**
 * The install instructions.
 *
 * One route, deliberately. An earlier version opened on a grid of platforms — WordPress,
 * Shopify, Webflow, Framer and so on — of which exactly one was implemented and the rest read
 * "Coming soon". That grid cost the customer a click and a decision before showing them
 * anything, and its main effect was to advertise eight things the product does not do. The
 * snippet is two script tags; pasting them into `<head>` is the same job on every platform, so
 * there is nothing for a platform picker to actually pick. (The design's "Install with" method
 * tabs are left out for the same reason: Routely has no tag-manager variant to offer.)
 */

/**
 * One numbered row of the install panel: a 26px circle, then the step's title and body.
 *
 * The circle is navy while the step is outstanding and green once the installation has been
 * confirmed; `tone="next"` marks the step that is the customer's next action, in brand blue.
 */
export function InstallStep({
  n,
  title,
  tone = "todo",
  aside,
  children,
  className,
}: {
  n: number;
  title: React.ReactNode;
  tone?: "todo" | "next" | "done";
  /** Right-aligned beside the title — the Verify step puts its button here. */
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-4 border-b border-divider px-[22px] py-5 last:border-b-0",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-[26px] shrink-0 place-items-center rounded-full font-heading text-[12.5px] font-bold text-white",
          tone === "done" ? "bg-success" : tone === "next" ? "bg-brand" : "bg-navy",
        )}
      >
        {tone === "done" ? "✓" : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h3 className="font-heading text-[14.5px] leading-[26px] font-bold tracking-[-0.01em]">
            {title}
          </h3>
          {aside}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The design's coral-diamond bullet line. */
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[13px] leading-normal text-pretty text-ink-2">
      <span aria-hidden className="mt-[7px] size-[5px] shrink-0 rotate-45 bg-coral" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

const inlineCode = "rounded-sm bg-divider px-1 py-px font-mono text-[12px] text-foreground";

/** Steps 1 and 2 of the install panel: copy the snippet, then put it in `<head>`. */
export function ManualInstall({
  sdkUrl,
  publicSiteId,
  domain,
  done = false,
}: {
  sdkUrl: string;
  publicSiteId: string;
  /** Named in the instructions, so the customer knows which site the snippet belongs to. */
  domain: string;
  /** The installation is confirmed, so both steps show as complete. */
  done?: boolean;
}) {
  const snippet = buildInstallSnippet({ sdkUrl, publicSiteId });

  return (
    <>
      <InstallStep n={1} title="Copy your Routely snippet" tone={done ? "done" : "todo"}>
        <CodeBlock code={snippet} label="Copy install snippet" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[12.5px] font-extrabold text-ink-2">Your site ID</span>
          <CopyValue value={publicSiteId} label="Copy site id" className="min-w-0 flex-1" />
        </div>
      </InstallStep>

      <InstallStep
        n={2}
        title={
          <>
            Add it to your website <code className={inlineCode}>&lt;head&gt;</code>
          </>
        }
        tone={done ? "done" : "todo"}
      >
        <ul className="flex flex-col gap-2">
          <Bullet>
            Paste it into the <code className={inlineCode}>&lt;head&gt;</code> of every page you
            want to test on {domain} — including the goal page. Adding it once to a shared header
            template covers them all.
          </Bullet>
          <Bullet>
            Keep both blocks, in this order. The first hides the page for up to{" "}
            <code className={inlineCode}>routelyTimeout</code> milliseconds so a redirected visitor
            never sees the original page first; it lifts on its own even if the tracking script
            never loads.
          </Bullet>
          <Bullet>
            Edit that number, or the <code className={inlineCode}>#fff</code> background, to suit
            your site. Then save your changes and verify below.
          </Bullet>
        </ul>
      </InstallStep>
    </>
  );
}

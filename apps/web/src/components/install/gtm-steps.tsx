import { ChevronRightIcon, ExternalLinkIcon } from "@/components/rt/icons";
import { focusRing } from "@/components/rt/styles";
import { GTM_URL, buildGtmSnippet } from "@/lib/gtm";
import { buildAntiFlickerSnippet } from "@/lib/snippet";
import { cn } from "@/lib/utils";

import { CodeBox } from "./code-box";
import { Connector, StepNum } from "./step-marks";

/** Installing through the customer's own Google Tag Manager. Routely never signs in to it. */
export function GtmSteps({
  domain,
  sdkUrl,
  publicSiteId,
}: {
  domain: string;
  sdkUrl: string;
  publicSiteId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[14px] leading-[21px] text-pretty text-[#4B5563]">
        Routely doesn’t change your Google Tag Manager container and can’t publish it for you. You
        add the tag and publish it yourself.
      </p>

      <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
        <GtmStep n={1} title="Open Google Tag Manager">
          <a
            href={GTM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex w-fit items-center gap-1 text-[14px] leading-5 font-medium text-[#0060AD] no-underline hover:underline",
              focusRing,
            )}
          >
            tagmanager.google.com
            <ExternalLinkIcon size={14} />
          </a>
        </GtmStep>
        <GtmStep n={2} title="Select the container for this website">
          <Body>Choose the container that’s installed on {domain}.</Body>
        </GtmStep>
        <GtmStep n={3} title="Add a Custom HTML tag">
          <Body>
            Go to Tags, click New, then Tag Configuration, and choose Custom HTML. Paste this code:
          </Body>
          <CodeBox code={buildGtmSnippet({ sdkUrl, publicSiteId })} />
        </GtmStep>
        <GtmStep n={4} title="Choose when it runs">
          <Body>
            Under Triggering, choose “Initialization - All Pages”, which fires earliest. “All Pages”
            also works. The tag must fire on every page your experiments run on.
          </Body>
        </GtmStep>
        <GtmStep n={5} title="Save the tag, then Submit and Publish">
          <Body>Saving a tag isn’t enough. Nothing goes live until you publish the container.</Body>
        </GtmStep>
        <GtmStep n={6} title="Come back and click Verify installation" last>
          <Body>Continue to the next step and we’ll check that the code runs on your page.</Body>
        </GtmStep>
      </ol>

      <details className="group rounded-xl border border-[#EEF0F3] bg-white">
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-2 rounded-xl px-3.5 py-2.5 text-[14px] leading-5 font-semibold text-[#111827] [&::-webkit-details-marker]:hidden",
            focusRing,
          )}
        >
          <ChevronRightIcon
            size={16}
            className="flex-none text-[#6B7280] transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
          Avoid a flash on redirect tests (optional)
        </summary>
        <div className="flex flex-col gap-2.5 border-t border-[#EEF0F3] px-3.5 pt-3 pb-3.5">
          <Body>
            Google Tag Manager loads after the page starts rendering, so visitors can see the
            original page for a moment in a Split URL or A/B test. To hide it, paste this block
            directly into your site’s <code className="text-[13px]">{"<head>"}</code>, above the
            Google Tag Manager snippet.
          </Body>
          <CodeBox code={buildAntiFlickerSnippet()} />
          <Body>Don’t put it inside Google Tag Manager. Verification doesn’t need it.</Body>
        </div>
      </details>
    </div>
  );
}

function GtmStep({
  n,
  title,
  last = false,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative flex min-w-0 items-start gap-3">
      {last ? null : <Connector />}
      <StepNum n={n} />
      <div className="flex min-w-0 flex-auto flex-col gap-1.5 pt-0.5">
        <span className="text-[14px] leading-[22px] font-semibold text-[#111827]">{title}</span>
        {children}
      </div>
    </li>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-[14px] leading-5 text-pretty text-[#4B5563]">{children}</p>;
}

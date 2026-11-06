/**
 * Help & Guides content. Plain data (`lib/guides-types.ts`), rendered by
 * `components/help/guide-content.tsx`.
 *
 * Kept short on purpose: a task is a walkthrough — one line per step, in the words on the screen,
 * with a screenshot of that screen (`lib/guide-shots.ts`). Text is only for what a picture can't
 * show. When a screen's copy or a rule changes, change it here and re-capture its screenshot.
 */

import { trackSnippet } from "@/lib/events";
import { SHOTS } from "@/lib/guide-shots";
import { GUIDE_SLUGS, type Guide, type GuideSlug } from "@/lib/guides-types";
import { MIN_CONVERSIONS_PER_ARM, MIN_VISITORS_PER_ARM } from "@/lib/verdict";

const GATE = `${MIN_VISITORS_PER_ARM.toLocaleString("en-US")} visitors and ${MIN_CONVERSIONS_PER_ARM} conversions`;

export const GUIDES: readonly Guide[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "How Routely works and which test to run.",
    sections: [
      {
        id: "overview",
        title: "How Routely works",
        blocks: [
          {
            kind: "p",
            text: "Routely shows different versions of a page to your visitors and tells you which one gets more of them to a goal page. Follow the checklist on your Dashboard.",
          },
          { kind: "shot", shot: SHOTS.checklist },
        ],
      },
      {
        id: "choose-test",
        title: "A/B test or Split URL test?",
        blocks: [
          {
            kind: "list",
            items: [
              [{ strong: "A/B test" }, " — change things on one page (text, colours, images)."],
              [{ strong: "Split URL test" }, " — send visitors to a different page you’ve built."],
            ],
          },
        ],
      },
    ],
  },

  {
    slug: "projects-and-tracking",
    title: "Projects and tracking",
    summary: "Add your website, install the tracking code, and connect Google Sheets.",
    sections: [
      {
        id: "projects",
        title: "Add a project",
        blocks: [
          {
            kind: "walkthrough",
            steps: [
              {
                title: "New project",
                text: "Projects → “New project”.",
                shot: SHOTS.newProject,
              },
              {
                title: "Name and address",
                text: [
                  "Enter a name and your website address, like ",
                  { code: "example.com" },
                  ". Click “Create project”.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "tracking-install",
        title: "Install the tracking code",
        blocks: [
          {
            kind: "walkthrough",
            steps: [
              {
                title: "Open the code",
                text: "In the project, choose “Show tracking code” on the Tracking pixel card.",
              },
              {
                title: "Copy and paste",
                text: [
                  "Click “Copy” and paste it into the ",
                  { code: "<head>" },
                  " of every page you test, and your goal page. Publish your site.",
                ],
                shot: SHOTS.trackingCode,
              },
              {
                title: "Verify",
                text: "Click “Next: Verify installation”, enter a page URL, and click “Verify installation”.",
              },
            ],
          },
        ],
      },
      {
        id: "tracking-gtm",
        title: "Install with Google Tag Manager",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open the project’s tracking code and choose “Google Tag Manager”.",
              "In Google Tag Manager, open the container for this website.",
              "Tags → New → Tag Configuration → Custom HTML, and paste the code.",
              "Under Triggering, choose “Initialization - All Pages”.",
              "Save, then Submit and Publish. A saved tag isn’t live until you publish.",
              "Back in Routely, click “Verify installation”. Your page opens in a new tab so the code can prove it runs.",
            ],
          },
          {
            kind: "note",
            tone: "info",
            title: "Routely doesn’t change your container",
            text: "You add and publish the tag yourself. Routely only reads the published container to help explain what went wrong.",
          },
          {
            kind: "note",
            tone: "tip",
            title: "Avoid a flash on redirect tests",
            text: "Tag Manager loads after the page starts to show. For A/B and Split URL tests, also paste the anti-flicker block straight into your site’s <head>, above the Tag Manager code. It’s optional and isn’t needed to verify.",
          },
        ],
      },
      {
        id: "google-sheets",
        title: "Connect Google Sheets (optional)",
        blocks: [
          {
            kind: "walkthrough",
            steps: [
              {
                title: "Open",
                text: "In the project, click the Google Sheets card.",
              },
              {
                title: "Connect",
                text: "Click “Connect email” and sign in to Google. Owners and Admins only.",
              },
              {
                title: "Choose a sheet",
                text: "Pick an existing spreadsheet, or click “Create Google Sheet”.",
              },
            ],
          },
          {
            kind: "p",
            text: "Routely writes the last 30 days into a “Routely” tab and keeps it up to date.",
          },
        ],
      },
    ],
  },

  {
    slug: "ab-testing",
    title: "A/B testing",
    summary: "Change elements on one page and test them.",
    sections: [
      {
        id: "ab-create",
        title: "Create an A/B test",
        blocks: [
          {
            kind: "walkthrough",
            steps: [
              {
                title: "Setup & variants",
                text: "Enter a name and the page URL. Click “Open visual editor” on each variant and make a change.",
                shot: SHOTS.abSetup,
              },
              {
                title: "Traffic",
                text: "Choose how visitors are split between versions.",
              },
              {
                title: "Targeting",
                text: "All visitors, or only some devices.",
              },
              {
                title: "Goal",
                text: "Enter the page that counts as a conversion — a page visitors reach next.",
              },
              {
                title: "Review & launch",
                text: "Check the tracking is found on your pages, then click “Launch experiment”.",
              },
              {
                title: "Confirm",
                text: "Click “Launch experiment” again. Your test is live.",
              },
            ],
          },
          {
            kind: "p",
            text: "Drafts save automatically — use “Continue editing” in Experiments to pick one up.",
          },
        ],
      },
      {
        id: "visual-editor",
        title: "Use the visual editor",
        blocks: [
          {
            kind: "steps",
            items: [
              "Click an element on your page.",
              "Change its text, colour, size or spacing — or hide it — in the panel.",
              "Click “Save changes”.",
            ],
          },
          {
            kind: "p",
            text: "The tracking code must be on the page for the editor to open it.",
          },
        ],
      },
    ],
  },

  {
    slug: "split-url-testing",
    title: "Split URL testing",
    summary: "Send visitors to different pages and compare them.",
    sections: [
      {
        id: "split-create",
        title: "Create a Split URL test",
        blocks: [
          {
            kind: "walkthrough",
            steps: [
              {
                title: "Setup & variants",
                text: "Enter a name, the Control URL and a URL for each variant.",
                shot: SHOTS.splitSetup,
              },
              {
                title: "Traffic",
                text: "Choose how visitors are split between pages.",
              },
              {
                title: "Targeting",
                text: "All visitors, or only some devices.",
              },
              {
                title: "Goal",
                text: "Enter the page that counts as a conversion, like a thank-you page.",
              },
              {
                title: "Review & launch",
                text: "Check the tracking is found on every page, then click “Launch experiment”.",
              },
            ],
          },
        ],
      },
      {
        id: "split-urls",
        title: "URL rules",
        blocks: [
          {
            kind: "list",
            items: [
              "All pages must be on your project’s website.",
              "Visitors on the Control URL are sent to their variant’s URL.",
              ["Ad tags like ", { code: "utm_source" }, " are kept when visitors are redirected."],
            ],
          },
        ],
      },
    ],
  },

  {
    slug: "custom-events",
    title: "Custom events",
    summary: "Track clicks, form submissions and purchases, and use them as goals.",
    sections: [
      {
        id: "events-overview",
        title: "What a custom event is",
        blocks: [
          {
            kind: "p",
            text: "An event is something a visitor does without changing page, like clicking Apply Now. It has two parts: a name you choose, and a way for Routely to detect it. A name alone tracks nothing.",
          },
          {
            kind: "list",
            items: [
              [{ strong: "Created · Not yet detected" }, " — nothing has arrived yet. Test it."],
              [{ strong: "Active" }, " — received in the last 7 days."],
              [{ strong: "Inactive" }, " — nothing for 7 days or more."],
              [{ strong: "Configuration error" }, " — Routely found a problem on your site."],
            ],
          },
        ],
      },
      {
        id: "events-setup",
        title: "Set up an event",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open a project → Events → “Create event”, or start from a suggestion.",
              "Name it, like apply_button_clicked.",
              "Choose how to detect it.",
              "Do the action on your site, then refresh the Events page to see it arrive.",
            ],
          },
          {
            kind: "list",
            items: [
              [{ strong: "Element click" }, " — pick an existing button or link. No code needed."],
              [
                { strong: "Form submission" },
                " — pick the form, then say how a successful submission shows: a success page, a success message, or your form plugin.",
              ],
              [{ strong: "JavaScript" }, " — your developer reports the event from your site."],
            ],
          },
          {
            kind: "note",
            tone: "warn",
            title: "A submit isn’t always a success",
            text: "“Form submitted” counts every submit the browser sends, including ones your server rejects, and counts nothing for forms sent with JavaScript. Use a success page or message when you can.",
          },
        ],
      },
      {
        id: "events-code",
        title: "Track an event with code",
        blocks: [
          {
            kind: "p",
            text: "Call this only after the action has succeeded, not when it starts:",
          },
          {
            kind: "code",
            label: "JavaScript",
            code: trackSnippet("contact_form_submitted"),
          },
          {
            kind: "p",
            text: [
              "Add safe details, and an ",
              { code: "id" },
              " so the same order can’t be counted twice:",
            ],
          },
          {
            kind: "code",
            label: "JavaScript",
            code: `window.routely.track("purchase_completed", { value: 150, currency: "USD" }, { id: "order_123" });`,
          },
          {
            kind: "note",
            tone: "warn",
            title: "Keep personal data out",
            text: "Don’t send passwords, card details, emails, phone numbers or names. Routely drops properties that look like them. Up to 10 properties, 200 characters each.",
          },
        ],
      },
      {
        id: "events-goals",
        title: "Use an event as a goal",
        blocks: [
          {
            kind: "p",
            text: "In either test’s Goal step, choose “Custom event” and pick from the project’s events. Test the event first, so you know it works before visitors arrive.",
          },
          {
            kind: "p",
            text: "Each visitor counts once, however many times the event happens. Results show the total as well, but the conversion rate uses converting visitors. Events from visitors outside the test appear on the Events page and never count as conversions.",
          },
        ],
      },
    ],
  },

  {
    slug: "launch-and-results",
    title: "Results and winners",
    summary: "Read your results and choose the version to keep.",
    sections: [
      {
        id: "launch",
        title: "Launch",
        blocks: [
          {
            kind: "p",
            text: "Routely checks the tracking code is on every page first. Once live, the setup is locked.",
          },
        ],
      },
      {
        id: "results",
        title: "Read your results",
        blocks: [
          { kind: "shot", shot: SHOTS.results },
          {
            kind: "p",
            text: `Routely names a likely winner only after every version has ${GATE}. Until then, keep the test running.`,
          },
        ],
      },
      {
        id: "winner",
        title: "Choose a winner",
        blocks: [
          {
            kind: "walkthrough",
            steps: [
              {
                title: "Open",
                text: "Click “End and choose winner” (or “Choose winner” on an ended test).",
              },
              {
                title: "Pick",
                text: "Keep the “Recommended” version, or pick your own. Click “End and keep …”.",
                shot: SHOTS.winnerDialog,
              },
              {
                title: "Update your site",
                text: "Make the winning change on your website — the results page shows what to do.",
              },
            ],
          },
        ],
      },
    ],
  },

  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    summary: "Quick fixes for common problems.",
    sections: [
      {
        id: "tracking-not-found",
        title: "Tracking code not found",
        blocks: [
          {
            kind: "faq",
            items: [
              {
                q: "“We couldn’t find the pixel”",
                a: [
                  "Publish your changes, clear any cache or CDN, and check a cookie banner isn’t blocking the code.",
                ],
              },
              {
                q: "“Different Project ID”",
                a: [
                  "Clear your website cache (your caching plugin) and your server cache (your hosting panel, and CDN if you use one) — an old cached copy often still carries an earlier code. If it still shows, replace the old code with this project’s code.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "launch-blocked",
        title: "Can’t launch",
        blocks: [
          {
            kind: "faq",
            items: [
              {
                q: "“Install tracking to launch”",
                a: ["Add the code to the page listed, then click “Check again”."],
              },
              {
                q: "“Another running experiment already tests this page”",
                a: ["Pause the other experiment first."],
              },
            ],
          },
        ],
      },
      {
        id: "editor-wont-load",
        title: "Visual editor won’t open",
        blocks: [
          {
            kind: "faq",
            items: [
              {
                q: "“Your site doesn’t let Routely show it here”",
                a: ["Install the tracking code on the page, or click “Open in a new window”."],
              },
              {
                q: "“Your browser blocked the editor window”",
                a: ["Allow pop-ups for Routely, then try again."],
              },
            ],
          },
        ],
      },
      {
        id: "page-flicker",
        title: "Control page shows before the variant",
        blocks: [
          {
            kind: "faq",
            items: [
              {
                q: "Visitors see the original page, then switch",
                a: [
                  "A caching or speed plugin is delaying the Routely code, so the page shows before Routely can decide. In the plugin, exclude “routely” and “sdk.js” from delayed/deferred JavaScript (LiteSpeed Cache: Page Optimization → Tuning), copy the tracking code again, and clear your website and server cache.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "no-visitors",
        title: "No visitors",
        blocks: [
          {
            kind: "faq",
            items: [
              {
                q: "The test shows no visitors",
                a: [
                  "Open the tested page yourself, then reload the results. Check the tracking code is on it and the URL matches exactly.",
                ],
              },
              {
                q: "Visitors, but no conversions",
                a: ["The goal page needs the tracking code too."],
              },
            ],
          },
        ],
      },
    ],
  },
];

/** A guide's first screenshot — the Help index shows it on the guide's card. */
export function findGuide(slug: string): Guide | null {
  return GUIDES.find((guide) => guide.slug === slug) ?? null;
}

/** Order check for the tests: one guide per slug, in `GUIDE_SLUGS` order. */
export const GUIDE_ORDER: readonly GuideSlug[] = GUIDE_SLUGS;

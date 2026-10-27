import type { Metadata } from "next";
import Link from "next/link";

import { authTextLink } from "@/components/auth/styles";
import { Code, ContactLine, H3, LegalPage, List, P, Table } from "@/components/legal/legal-page";
import { env } from "@/env";
import { LEGAL_OPERATOR } from "@/lib/legal";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Routely collects, uses and protects information.",
};

/**
 * Privacy Policy. Every statement here describes what the code actually does — the cookies and
 * storage keys, the retention periods, the Google scopes, the subprocessors. Change it when they
 * change, and bump `LEGAL_UPDATED`.
 */
export default function PrivacyPolicyPage() {
  const email = env.SUPPORT_EMAIL ?? null;
  const contact = <ContactLine email={email} />;

  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <>
          <P>
            Routely is an experimentation tool: it lets businesses test different versions of their
            web pages and measure which one performs better. It is operated by {LEGAL_OPERATOR}{" "}
            (“we”, “us”). This policy explains what information Routely handles, why, and the
            choices you have.
          </P>
          <P>
            It covers two groups of people: <strong>customers</strong>, who sign in to Routely to
            run experiments, and <strong>website visitors</strong>, who browse a customer’s website
            where the Routely snippet is installed.
          </P>
        </>
      }
      sections={[
        {
          id: "roles",
          title: "Our role",
          body: (
            <>
              <P>
                For customer accounts, we decide how information is used and are responsible for it
                (the “controller”).
              </P>
              <P>
                For website visitors, the customer who installed Routely on their website decides
                what to test and measure, and we process visitor information on their behalf and
                under their instructions (we are their “processor”). If you are a visitor and have a
                question about a website’s use of Routely, contact that website’s owner; we will
                help them respond.
              </P>
            </>
          ),
        },
        {
          id: "customer-information",
          title: "Information we collect from customers",
          body: (
            <>
              <H3>Account information</H3>
              <List
                items={[
                  "Your name and email address.",
                  "Your password, if you sign up with one. We store only a salted scrypt hash, never the password itself.",
                  "If you sign in with Google: your Google account’s name, email address and profile picture, and whether Google has verified the address.",
                  "Your notification preferences and the workspace you last used.",
                ]}
              />
              <H3>Sign-in sessions</H3>
              <P>
                For each signed-in device we keep the browser and operating system (from the
                browser’s user agent), an approximate city and country derived from the request’s IP
                address by our hosting provider, and when the session started and was last used. We
                do not store the IP address itself. This powers “Where you’re signed in” in Settings
                and the email we send when you sign in from a new device.
              </P>
              <H3>Workspace content</H3>
              <List
                items={[
                  "Projects: names and website domains.",
                  "Experiments: names, page URLs, variants and the visual changes you make, traffic settings, goals and an activity log of who did what.",
                  "Team: the people in your workspace, their roles, and the email addresses of people you invite.",
                  "Installation checks: when you ask us to verify a page, we fetch that public page and record whether the snippet was found. To show each project's icon, we also fetch its public homepage and the favicon it declares.",
                ]}
              />
              <H3>Google Sheets integration (optional)</H3>
              <P>
                If an admin connects Google Sheets, we store the connecting Google account’s email
                address, an OAuth refresh token (encrypted at rest with AES-256-GCM), and the ID of
                each spreadsheet a project exports to. See{" "}
                <a href="#google" className={authTextLink}>
                  Google user data
                </a>
                .
              </P>
            </>
          ),
        },
        {
          id: "visitor-information",
          title: "Information collected about website visitors",
          body: (
            <>
              <P>
                When a customer installs the Routely snippet, it collects only what is needed to run
                and measure their experiments:
              </P>
              <List
                items={[
                  "A random visitor ID generated in the browser. It is not derived from any personal detail and is used only on that website.",
                  "Which experiments the visitor was included in and which version they were shown.",
                  "Pages viewed on that website (the page address, with advertising parameters such as utm_source and gclid removed), when, and how long the page was visible in the browser.",
                  "Whether the visitor reached the goal page the customer chose (a conversion).",
                  "A daily count of distinct visitors per website and per page, used for traffic figures.",
                ]}
              />
              <P>
                The browser’s user agent is read to filter out bots and to tell desktop, tablet and
                mobile apart for device targeting; it is not stored. The IP address is not stored.
                Routely does not track visitors across different websites, does not build
                advertising profiles, does not use device fingerprinting, and does not collect
                names, email addresses or form contents from visitors.
              </P>
              <P>
                Customers are responsible for telling their visitors about Routely and for obtaining
                any consent their local law requires before the snippet runs (for example, through
                their cookie banner).
              </P>
            </>
          ),
        },
        {
          id: "use",
          title: "How we use information",
          body: (
            <List
              items={[
                "To provide Routely: signing you in, running experiments, calculating results and showing them to your team.",
                "To keep accounts secure: rate-limiting sign-in attempts, listing and revoking sessions, and alerting you to sign-ins from new devices.",
                "To send email you need — verification, password reset, team invitations — and the notifications you have chosen to receive, such as “a result is ready” or “tracking stopped”. You can turn notifications off in Settings.",
                "To export your project’s figures to Google Sheets, if you set that up.",
                "To diagnose problems and keep the service working.",
              ]}
            />
          ),
        },
        {
          id: "no-sale",
          title: "What we do not do",
          body: (
            <P>
              We do not sell personal information, share it for advertising, or use it to train
              machine-learning models. We do not show ads.
            </P>
          ),
        },
        {
          id: "google",
          title: "Google user data",
          body: (
            <>
              <P>
                <strong>Google sign-in</strong> asks Google for your name, email address and profile
                picture (the <Code>openid</Code>, <Code>email</Code> and <Code>profile</Code>{" "}
                scopes), used only to create and sign in to your Routely account.
              </P>
              <P>
                <strong>The Google Sheets integration</strong> asks for <Code>openid</Code>,{" "}
                <Code>userinfo.email</Code> and <Code>drive.file</Code>. The <Code>drive.file</Code>{" "}
                scope gives Routely access only to spreadsheets Routely creates or that you choose
                in Google’s file picker — not to the rest of your Google Drive. Routely uses it only
                to create those spreadsheets and to write your project’s daily figures to a tab
                named “Routely” in them. Disconnecting the integration in Routely stops all access,
                and you can also revoke it at any time from your Google Account’s security settings.
              </P>
              <P>
                Routely’s use and transfer of information received from Google APIs adheres to the{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  className={authTextLink}
                  rel="noreferrer"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements. We do not use Google user data for
                advertising, do not sell it, do not let people read it except where you ask us to
                (for example, for support), for security, or where the law requires, and do not use
                it to train AI or machine-learning models.
              </P>
            </>
          ),
        },
        {
          id: "sharing",
          title: "Who we share information with",
          body: (
            <>
              <P>We use these service providers to run Routely:</P>
              <Table
                head={["Provider", "Purpose", "Location"]}
                rows={[
                  [
                    "Vercel",
                    "Hosting the application and content delivery",
                    "Global edge; servers in Singapore",
                  ],
                  ["Neon", "Database", "Singapore (AWS ap-southeast-1)"],
                  ["Resend", "Delivering email", "United States"],
                  ["Google", "Google sign-in and the Google Sheets integration", "Global"],
                ]}
              />
              <P>Besides them, information is shared only:</P>
              <List
                items={[
                  "Within your workspace: its members see the workspace’s projects, experiments, results and team list, according to their role.",
                  "Through share links: anyone with an experiment’s share link can view that experiment’s results until the link is turned off.",
                  "When the law requires it, or to protect the rights, safety or property of our users or others.",
                  "If Routely is sold or merged, with the new owner, who would remain bound by this policy.",
                ]}
              />
            </>
          ),
        },
        {
          id: "transfers",
          title: "Where information is stored",
          body: (
            <P>
              Routely’s database is in Singapore, and pages are delivered through servers around the
              world. Wherever information is handled, we protect it as this policy describes.
            </P>
          ),
        },
        {
          id: "retention",
          title: "How long we keep information",
          body: (
            <List
              items={[
                "Account information: for as long as your account exists.",
                "Sign-in sessions: until you sign out, revoke them, reset your password, or 30 days without renewal.",
                "Password-reset links expire after 1 hour, email-verification codes and links after 24 hours, team invitations after 7 days.",
                "Daily visitor counts: 400 days, then deleted automatically.",
                "Experiments and their visitor data: until the customer deletes the experiment or its project, which deletes everything beneath it.",
                "Google Sheets connection: until it is disconnected.",
              ]}
            />
          ),
        },
        {
          id: "cookies",
          title: "Cookies and browser storage",
          body: (
            <>
              <H3>On Routely itself</H3>
              <P>We use only cookies that are needed for Routely to work:</P>
              <Table
                head={["Name", "Purpose", "Lasts"]}
                rows={[
                  [
                    <Code key="c">
                      authjs.
                      <wbr />
                      session-token
                    </Code>,
                    "Keeps you signed in",
                    "30 days",
                  ],
                  [
                    <Code key="c">
                      authjs.
                      <wbr />
                      csrf-token
                    </Code>,
                    "Protects sign-in against cross-site request forgery",
                    "Browser session",
                  ],
                  [
                    <Code key="c">
                      authjs.
                      <wbr />
                      callback-url
                    </Code>,
                    "Remembers where to return after signing in",
                    "Browser session",
                  ],
                  [
                    <Code key="c">routely-verify</Code>,
                    "Lets this browser enter the code that verifies a new account’s email",
                    "24 hours",
                  ],
                  [
                    <Code key="c">routely-invite</Code>,
                    "Carries a team invitation through Google sign-up",
                    "15 minutes",
                  ],
                ]}
              />
              <P>
                Sign-in with Google briefly sets further Auth.js cookies to secure the round trip to
                Google. We use no analytics or advertising cookies.
              </P>
              <H3>On customers’ websites</H3>
              <P>
                The snippet stores the random visitor ID in a first-party cookie,{" "}
                <Code>routely_vid</Code> (1 year), and in the browser’s local storage, along with
                keys beginning <Code>routely_</Code> that remember the visitor’s experiment
                versions, so a visitor sees the same version on every visit and is not counted
                twice.
              </P>
            </>
          ),
        },
        {
          id: "security",
          title: "Security",
          body: (
            <P>
              All traffic is encrypted in transit (HTTPS). Passwords are hashed with scrypt, and
              Google refresh tokens are encrypted at rest. Sessions are stored on the server, so
              signing out or revoking a session ends it immediately. Every request is checked
              against the person’s role in the workspace. No system is perfectly secure; if we learn
              of a breach that affects your information, we will tell you without undue delay.
            </P>
          ),
        },
        {
          id: "rights",
          title: "Your choices and rights",
          body: (
            <>
              <P>
                You can update your name, email address and password, sign out other devices and
                change notifications in{" "}
                <Link href={routes.settings} className={authTextLink}>
                  Settings
                </Link>
                .
              </P>
              <P>
                Depending on where you live, you may have the right to access, correct, delete or
                receive a copy of your personal information, and to object to or restrict how we use
                it. To make a request — including deleting your account, which is not yet available
                in Settings — contact us at {contact}. We will respond within 30 days. You may also
                complain to your local data protection authority.
              </P>
              <P>
                Website visitors can clear the <Code>routely_vid</Code> cookie and the{" "}
                <Code>routely_</Code> storage keys in their browser at any time, which resets their
                Routely identity on that website.
              </P>
            </>
          ),
        },
        {
          id: "children",
          title: "Children",
          body: (
            <P>
              Routely is a business tool and is not directed to children under 16. We do not
              knowingly collect personal information from them.
            </P>
          ),
        },
        {
          id: "changes",
          title: "Changes to this policy",
          body: (
            <P>
              We will update this page when our practices change and revise the date at the top. If
              a change is significant, we will also tell signed-up customers by email before it
              takes effect.
            </P>
          ),
        },
        {
          id: "contact",
          title: "Contact",
          body: (
            <P>
              Questions about this policy or your information: {LEGAL_OPERATOR}, at {contact}.
            </P>
          ),
        },
      ]}
    />
  );
}

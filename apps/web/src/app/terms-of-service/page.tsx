import type { Metadata } from "next";
import Link from "next/link";

import { authTextLink } from "@/components/auth/styles";
import { ContactLine, LegalPage, List, P } from "@/components/legal/legal-page";
import { env } from "@/env";
import { LEGAL_OPERATOR } from "@/lib/legal";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern use of Routely.",
};

/**
 * Terms of Service. Deliberately without a governing-law clause (the operator's decision,
 * 2026-10-26). The results section restates what `lib/verdict.ts` and `NOT_PROOF_NOTE` already
 * say in the product, so the terms never promise more than the screens do.
 */
export default function TermsOfServicePage() {
  const contact = <ContactLine email={env.SUPPORT_EMAIL ?? null} />;
  const privacy = (
    <Link href={routes.privacyPolicy} className={authTextLink}>
      Privacy Policy
    </Link>
  );

  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <P>
          These terms govern your use of Routely, a service operated by {LEGAL_OPERATOR} (“we”,
          “us”). By creating an account or using Routely you agree to them. If you use Routely for
          an organisation, you agree on its behalf and confirm you have authority to do so.
        </P>
      }
      sections={[
        {
          id: "service",
          title: "The service",
          body: (
            <P>
              Routely lets you run experiments on websites you control: it splits visitors between
              versions of a page — separate URLs, or visual changes applied to one page — and
              reports how each version performs against a goal you choose. It works through a
              tracking snippet you install on your website.
            </P>
          ),
        },
        {
          id: "accounts",
          title: "Your account and workspace",
          body: (
            <List
              items={[
                "Give accurate information and keep it up to date. You must be at least 16 years old.",
                "Keep your password safe and tell us promptly if you suspect someone else has used your account. You are responsible for activity under your account.",
                "A workspace’s owner and admins decide who joins it and with which role. They are responsible for the people they invite and for removing access that is no longer needed.",
              ]}
            />
          ),
        },
        {
          id: "websites",
          title: "Your websites and your visitors",
          body: (
            <>
              <P>When you install the snippet or run an experiment, you confirm that:</P>
              <List
                items={[
                  "you own the website or are authorised by its owner to test it;",
                  "you tell your visitors about Routely in your own privacy notice, and obtain any consent the law requires before the snippet runs (for example, through a cookie banner);",
                  "your experiments comply with applicable law, including consumer-protection, advertising and accessibility rules.",
                ]}
              />
              <P>
                You are the controller of your visitors’ information, and we process it on your
                behalf as described in our {privacy}.
              </P>
            </>
          ),
        },
        {
          id: "acceptable-use",
          title: "Acceptable use",
          body: (
            <>
              <P>You must not use Routely to:</P>
              <List
                items={[
                  "deceive visitors in harmful ways — phishing, scams, impersonation, or pages that misrepresent prices or terms;",
                  "deliver malware, or redirect visitors to content that is illegal;",
                  "collect sensitive information about visitors, or use Routely to identify individual visitors;",
                  "interfere with Routely — overloading it, sending forged tracking data, probing for vulnerabilities without our permission, or getting around its limits or access controls;",
                  "resell or provide Routely to others as a service, unless we agree in writing.",
                ]}
              />
            </>
          ),
        },
        {
          id: "content",
          title: "Your content",
          body: (
            <P>
              You keep all rights to the content you put into Routely — projects, experiments, page
              changes and results. You give us permission to host, copy and process it only as
              needed to run Routely for you, including showing it to your workspace members and to
              anyone you send a share link. You are responsible for having the rights to that
              content.
            </P>
          ),
        },
        {
          id: "results",
          title: "Results are estimates",
          body: (
            <>
              <P>
                Routely reports what it measured and an estimated chance that one version beats
                another. That chance is a probability, not proof: a version marked as likely better
                can turn out not to be. Time on page measures how long a page was visible in the
                browser, not attention, and is approximate. Measurements can also be affected by ad
                blockers, browser privacy settings and other factors outside our control.
              </P>
              <P>
                Decisions you make based on results are yours. We do not promise any particular
                business outcome.
              </P>
            </>
          ),
        },
        {
          id: "third-parties",
          title: "Third-party services",
          body: (
            <P>
              Some features rely on other companies’ services, such as Google sign-in and Google
              Sheets. Your use of those services is also governed by their terms, and we are not
              responsible for them. If a third party changes or withdraws its service, the feature
              that depends on it may stop working.
            </P>
          ),
        },
        {
          id: "changes-to-service",
          title: "Changes and availability",
          body: (
            <P>
              We work to keep Routely available and reliable, but we do not guarantee it will be
              uninterrupted or error-free. We may add, change or remove features. If we remove one
              you rely on, we will try to give reasonable notice.
            </P>
          ),
        },
        {
          id: "termination",
          title: "Suspension and ending your use",
          body: (
            <>
              <P>
                You may stop using Routely at any time. Remove the snippet from your website, and
                contact us at {contact} if you would like your account deleted.
              </P>
              <P>
                We may suspend or end your access if you seriously or repeatedly breach these terms,
                if your use puts Routely, its users or visitors at risk, or if the law requires it.
                Where reasonable, we will tell you first and give you a chance to fix the problem.
              </P>
            </>
          ),
        },
        {
          id: "disclaimer",
          title: "Disclaimer",
          body: (
            <P>
              To the extent the law allows, Routely is provided “as is” and “as available”, without
              warranties of any kind, express or implied, including warranties of merchantability,
              fitness for a particular purpose and non-infringement.
            </P>
          ),
        },
        {
          id: "liability",
          title: "Limitation of liability",
          body: (
            <P>
              To the extent the law allows, we are not liable for indirect, incidental, special,
              consequential or punitive damages, or for lost profits, revenue, data or goodwill,
              arising from your use of Routely. Our total liability for any claim relating to
              Routely is limited to the greater of the amount you paid us for Routely in the 12
              months before the claim and USD 100. Nothing in these terms limits liability that
              cannot be limited by law.
            </P>
          ),
        },
        {
          id: "indemnity",
          title: "Indemnity",
          body: (
            <P>
              You agree to defend and compensate us against claims by third parties — including your
              website’s visitors — arising from your websites, your experiments, your content, or
              your breach of these terms.
            </P>
          ),
        },
        {
          id: "changes",
          title: "Changes to these terms",
          body: (
            <P>
              We may update these terms. We will revise the date at the top and, for significant
              changes, tell signed-up customers by email before they take effect. If you keep using
              Routely after that, you accept the updated terms.
            </P>
          ),
        },
        {
          id: "contact",
          title: "Contact",
          body: (
            <P>
              Questions about these terms: {LEGAL_OPERATOR}, at {contact}.
            </P>
          ),
        },
      ]}
    />
  );
}

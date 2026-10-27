import { describe, expect, it } from "vitest";

import {
  type RenderedEmail,
  appLink,
  confirmEmailChangeTemplate,
  emailChangedTemplate,
  escapeHtml,
  experimentPausedTemplate,
  inviteTemplate,
  newSignInTemplate,
  passwordChangedTemplate,
  renderNotificationEmail,
  resetPasswordTemplate,
  resultReadyTemplate,
  sheetsSyncFailedTemplate,
  trackingStoppedTemplate,
  verifyEmailTemplate,
} from "@/server/email/templates";
import { safeUrl, subjectText } from "@/server/email/templates/layout";

const APP = "https://app.routely.test";
const EVIL = `<script>alert("x")</script> & "Co" 'n'`;
const PREFS = `${APP}/settings?tab=notifications`;
const envelope = { recipientName: EVIL, workspaceName: EVIL, preferencesUrl: PREFS };

/** Every one of the 11 emails, each fed hostile customer text wherever customer text goes. */
const ALL: Record<string, { email: RenderedEmail; link?: string }> = {
  verify: {
    email: verifyEmailTemplate({
      name: EVIL,
      code: "012345",
      verifyUrl: `${APP}/verify-email/tok1`,
      expiresInHours: 24,
    }),
    link: `${APP}/verify-email/tok1`,
  },
  reset: {
    email: resetPasswordTemplate({
      name: EVIL,
      resetUrl: `${APP}/reset-password/tok2`,
      expiresInMinutes: 60,
    }),
    link: `${APP}/reset-password/tok2`,
  },
  confirmEmailChange: {
    email: confirmEmailChangeTemplate({
      name: EVIL,
      newEmail: "new@acme.test",
      confirmUrl: `${APP}/settings/email/confirm?token=tok3&x=1`,
      expiresInHours: 24,
    }),
    link: `${APP}/settings/email/confirm?token=tok3&x=1`,
  },
  emailChanged: {
    email: emailChangedTemplate({
      name: EVIL,
      oldEmail: "old@acme.test",
      newEmail: "new@acme.test",
    }),
  },
  passwordChanged: {
    email: passwordChangedTemplate({
      name: EVIL,
      changedAt: new Date("2026-10-19T09:12:00Z"),
      viaReset: true,
    }),
  },
  newSignIn: {
    email: newSignInTemplate({
      name: EVIL,
      device: EVIL,
      location: EVIL,
      at: new Date("2026-10-19T09:12:00Z"),
      sessionsUrl: `${APP}/settings`,
    }),
    link: `${APP}/settings`,
  },
  invite: {
    email: inviteTemplate({
      inviterName: EVIL,
      workspaceName: EVIL,
      roleLabel: "Editor",
      inviteUrl: `${APP}/invite/tok4`,
      expiresInDays: 7,
    }),
    link: `${APP}/invite/tok4`,
  },
  resultReady: {
    email: resultReadyTemplate({
      ...envelope,
      experimentName: EVIL,
      projectName: EVIL,
      experimentUrl: `${APP}/experiments/e1`,
    }),
    link: `${APP}/experiments/e1`,
  },
  trackingStopped: {
    email: trackingStoppedTemplate({
      ...envelope,
      projectName: EVIL,
      domain: "acme.test",
      lastSeenAt: new Date(Date.now() - 30 * 3_600_000),
      projectUrl: `${APP}/projects/w1`,
    }),
    link: `${APP}/projects/w1`,
  },
  sheetsSyncFailed: {
    email: sheetsSyncFailedTemplate({
      ...envelope,
      projectName: EVIL,
      error: EVIL,
      projectUrl: `${APP}/projects/w1`,
    }),
    link: `${APP}/projects/w1`,
  },
  experimentPaused: {
    email: experimentPausedTemplate({
      ...envelope,
      experimentName: EVIL,
      projectName: EVIL,
      actorName: EVIL,
      experimentUrl: `${APP}/experiments/e1`,
    }),
    link: `${APP}/experiments/e1`,
  },
};

describe("every template", () => {
  it("covers all 11 emails from spec §1.3", () => {
    expect(Object.keys(ALL)).toHaveLength(11);
  });

  for (const [name, { email, link }] of Object.entries(ALL)) {
    describe(name, () => {
      it("never puts customer text into the HTML unescaped", () => {
        expect(email.html).not.toContain("<script>");
        expect(email.html).not.toContain(`"Co"`);
        expect(email.html).not.toContain(`'n'`);
      });

      it("returns a one-line, non-empty subject and both bodies", () => {
        expect(email.subject.length).toBeGreaterThan(0);
        expect(email.subject).not.toMatch(/[\r\n]/);
        expect(email.text.length).toBeGreaterThan(0);
        expect(email.html).toMatch(/^<!doctype html>/);
      });

      if (link) {
        it("carries its link in the plain text and as an escaped href", () => {
          expect(email.text).toContain(link);
          expect(email.html).toContain(`href="${escapeHtml(link)}"`);
        });
      }
    });
  }

  it("keeps customer text readable, unescaped, in the plain-text body", () => {
    // Plain text is not HTML: escaping it would show "&lt;" to the reader.
    expect(ALL.resultReady!.email.text).toContain(`<script>alert("x")</script> & "Co" 'n'`);
    expect(ALL.resultReady!.email.html).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Co&quot; &#39;n&#39;",
    );
  });

  it("links every notification to its preferences", () => {
    for (const name of ["resultReady", "trackingStopped", "sheetsSyncFailed", "experimentPaused"]) {
      const { email } = ALL[name]!;
      expect(email.text).toContain(PREFS);
      expect(email.html).toContain(`href="${escapeHtml(PREFS)}"`);
    }
  });

  it("does not claim a winner or significance in the result-ready email", () => {
    const { text } = ALL.resultReady!.email;
    expect(text).not.toMatch(/winner|significan|chance to beat/i);
  });
});

describe("invite", () => {
  it("names the workspace in the subject, flattened and capped", () => {
    const email = inviteTemplate({
      inviterName: "Sam Lee",
      workspaceName: "Acme\r\nBcc: victim@example.com",
      roleLabel: "Admin",
      inviteUrl: `${APP}/invite/t`,
      expiresInDays: 7,
    });
    expect(email.subject).toBe("You're invited to Acme Bcc: victim@example.com on Routely");
    expect(email.text).toContain("as an Admin");
  });
});

describe("verifyEmailTemplate", () => {
  it("puts the code in the subject and both bodies, beside the link", () => {
    const email = verifyEmailTemplate({
      name: "Ada",
      code: "012345",
      verifyUrl: `${APP}/verify-email/tok1`,
      expiresInHours: 24,
    });
    expect(email.subject).toBe("012345 is your Routely verification code");
    expect(email.text).toContain("Your code: 012345");
    expect(email.html).toContain(">012345</p>");
    expect(email.text).toContain(`${APP}/verify-email/tok1`);
  });
});

describe("layout guards", () => {
  it("refuses a non-http link", () => {
    expect(() => safeUrl("javascript:alert(1)")).toThrow();
    expect(() => safeUrl("/relative")).toThrow();
    expect(() =>
      verifyEmailTemplate({
        name: null,
        code: "012345",
        verifyUrl: "javascript:alert(1)",
        expiresInHours: 24,
      }),
    ).toThrow();
  });

  it("caps long subject text with an ellipsis", () => {
    expect(subjectText("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("greets without a name", () => {
    const email = resetPasswordTemplate({
      name: null,
      resetUrl: `${APP}/r/t`,
      expiresInMinutes: 60,
    });
    expect(email.text).toContain("Hi,");
  });
});

describe("renderNotificationEmail", () => {
  it("builds absolute links from ids on the configured origin", () => {
    const email = renderNotificationEmail(
      "EXPERIMENT_PAUSED",
      { experimentId: "exp 1", experimentName: "Pricing", projectName: "Acme", actorName: "Sam" },
      { name: "Kim", workspaceName: "Acme team" },
      `${APP}/`,
    );
    expect(email.subject).toBe("Pricing was paused");
    expect(email.text).toContain(`${APP}/experiments/exp%201`);
    expect(email.text).toContain(`${APP}/settings?tab=notifications`);
  });

  it("points project alerts at the project dashboard", () => {
    const email = renderNotificationEmail(
      "SHEETS_SYNC_FAILED",
      { websiteId: "w9", projectName: "Acme", error: "The spreadsheet was deleted." },
      { name: null, workspaceName: "Acme team" },
      APP,
    );
    expect(email.text).toContain(`${APP}/projects/w9`);
    expect(email.text).toContain("The spreadsheet was deleted.");
  });

  it("joins paths onto an origin with or without a trailing slash", () => {
    expect(appLink("https://a.test", "/x")).toBe("https://a.test/x");
    expect(appLink("https://a.test/", "/x?y=1")).toBe("https://a.test/x?y=1");
  });
});

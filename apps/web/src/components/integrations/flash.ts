/**
 * Turns the OAuth callback's redirect codes (`?connected=1`, `?error=…&detail=…`) into a message.
 * Pure — no server imports — so the integrations page can call it directly.
 */
export function readOAuthFlash(
  params: Record<string, string | string[] | undefined>,
): { tone: "success" | "error"; title: string; body: string } | null {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  if (first("connected")) {
    return {
      tone: "success",
      title: "Google connected.",
      body: "Now choose or create the spreadsheet this project should write to.",
    };
  }

  const error = first("error");
  if (!error) return null;

  const messages: Record<string, { title: string; body: string }> = {
    denied: {
      title: "Connection cancelled.",
      body: "You cancelled on Google’s screen, so nothing was connected.",
    },
    state: {
      title: "That connection attempt expired.",
      body: "For your security the request is only valid for a few minutes. Please try again.",
    },
    invalid: { title: "Google’s response was incomplete.", body: "Please try connecting again." },
    google: {
      title: "Google refused the request.",
      body: "Please try again. If it keeps happening, check this Google account can use Google Sheets.",
    },
    not_configured: {
      title: "This integration is not configured.",
      body: "Google OAuth credentials are missing on this deployment.",
    },
    connect: { title: "Couldn’t finish connecting.", body: first("detail") ?? "Please try again." },
  };

  return {
    tone: "error",
    ...(messages[error] ?? { title: "Couldn’t connect.", body: "Please try again." }),
  };
}

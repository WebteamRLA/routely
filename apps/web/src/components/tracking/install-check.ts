import type { InstallCheckResult } from "@/server/actions/pixel.actions";

/**
 * Pure wording for the install panel's verification result. The design (v2) has no per-domain
 * list, so whatever a check missed is told in one line under the Verify button.
 */

/** Outcome of checking one domain's home page for the snippet. */
export type DomainResult =
  | { kind: "found" }
  | { kind: "missing" }
  | { kind: "wrong-site" }
  | { kind: "error"; message: string };

export type DomainProblem = {
  domain: string;
  result: Exclude<DomainResult, { kind: "found" }>;
};

/** Maps the server action's answer for one page onto a domain outcome. */
export function domainResult(result: InstallCheckResult): DomainResult {
  if (!result.ok) return { kind: "error", message: result.message };
  if (result.snippetFound) return { kind: "found" };
  return { kind: result.wrongSiteId ? "wrong-site" : "missing" };
}

/** The domains a check did not find the snippet on, in the project's domain order. */
export function problemsOf(
  domains: string[],
  results: Record<string, DomainResult>,
): DomainProblem[] {
  return domains.flatMap((domain) => {
    const result = results[domain];
    return result && result.kind !== "found" ? [{ domain, result }] : [];
  });
}

const SHORT: Record<DomainProblem["result"]["kind"], string> = {
  missing: "snippet not found",
  "wrong-site": "another project’s snippet",
  error: "couldn’t load",
};

/** The full sentence for one domain the check missed. */
export function problemSentence({ domain, result }: DomainProblem): string {
  if (result.kind === "error") return result.message;
  if (result.kind === "wrong-site")
    return `${domain} has a Routely snippet for a different project. Replace it with the snippet above.`;
  return `The snippet wasn’t found on ${domain}.`;
}

/**
 * One line for everything the check missed: the full reason when one domain failed, a compact
 * "Not detected on a (reason), b (reason)." when several did. Null when nothing failed.
 */
export function summariseProblems(problems: DomainProblem[]): string | null {
  const [first, ...rest] = problems;
  if (!first) return null;
  if (rest.length === 0) return problemSentence(first);
  const list = problems.map((p) => `${p.domain} (${SHORT[p.result.kind]})`).join(", ");
  return `Not detected on ${list}.`;
}

/** "a.com", "a.com and b.com", "a.com, b.com and c.com". */
export function listDomains(domains: string[]): string {
  const last = domains[domains.length - 1];
  if (domains.length <= 1 || last === undefined) return last ?? "your site";
  return `${domains.slice(0, -1).join(", ")} and ${last}`;
}

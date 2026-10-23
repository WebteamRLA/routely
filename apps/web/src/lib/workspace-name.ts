/** Longest workspace name the product accepts. */
export const WORKSPACE_NAME_MAX = 80;

/**
 * The name a new user's own workspace starts with: "{first name}’s workspace".
 *
 * The first word of the profile name, falling back to the email's local part when there is no
 * name (a password sign-up may not give one). The migration that created workspaces for existing
 * users applies the same rule in SQL, so both paths name a workspace identically.
 */
export function personalWorkspaceName(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "My";
  const first = source.split(/\s+/)[0] ?? source;
  return `${first.slice(0, 64)}’s workspace`.slice(0, WORKSPACE_NAME_MAX);
}

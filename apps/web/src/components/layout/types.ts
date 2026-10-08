/** What the shell knows about each project (serialisable; built by `(app)/layout.tsx`). */
export interface ShellProject {
  id: string;
  name: string;
  /** Primary domain. */
  domain: string;
  /** Every domain, primary first (duplicate-domain check in the project modal). */
  domains: string[];
  iconUrl: string | null;
  archived: boolean;
  /** Experiments in the project (the "Experiments" nav count). */
  experiments: number;
}

export interface ShellUser {
  name: string | null;
  email: string;
  image: string | null;
}

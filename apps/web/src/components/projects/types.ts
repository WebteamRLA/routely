/** A Manage-projects row (serialisable; built by `app/(app)/projects/page.tsx`). */
export interface ProjectRowData {
  id: string;
  name: string;
  domain: string;
  domains: string[];
  iconUrl: string | null;
  archived: boolean;
  total: number;
  running: number;
  /** Running experiments — paused before archiving, as the design promises. */
  runningIds: string[];
  /** "Last activity 2h ago" / "Created Oct 4". */
  activity: string;
}

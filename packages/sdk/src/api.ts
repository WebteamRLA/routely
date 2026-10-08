/**
 * The public API: `window.routely.track(key)` and the pre-load queue.
 *
 * A page or tag manager may record an event before this bundle has run. The queue pattern
 * covers that without making the caller check anything:
 *
 *   (window.routely = window.routely || []).push(["track", "signup"]);
 *
 * and, once the install snippet's inline block has run, `routely.track("signup")` works even
 * before the bundle has loaded — the block gives the queue array a `track` that pushes onto it.
 * When the bundle boots it replays the queue and replaces the global with the live API, whose
 * `push` keeps accepting the same entries.
 */

/** Event keys the SDK will send. The server matches them exactly against project metrics. */
const KEY = /^[A-Za-z0-9_.:-]{1,64}$/;

export function isTrackKey(value: unknown): value is string {
  return typeof value === "string" && KEY.test(value);
}

/** Runs one queued command. Unknown commands are ignored: the queue is shared with the page. */
export function runCommand(entry: unknown, track: (key: unknown) => unknown): void {
  try {
    const command = entry as ArrayLike<unknown> | null;
    if (command && typeof command === "object" && command[0] === "track") track(command[1]);
  } catch {
    // A malformed entry is the page's problem, never an error thrown back into it.
  }
}

/**
 * Replays whatever was queued before the bundle ran: an array of commands, or an object with a
 * `q` array. Anything else — including another copy of the SDK's own state — is left alone.
 */
export function drainQueue(existing: unknown, track: (key: unknown) => unknown): number {
  try {
    if (!existing || typeof existing !== "object") return 0;
    const queue = Array.isArray(existing) ? existing : (existing as { q?: unknown }).q;
    if (!Array.isArray(queue)) return 0;
    for (const entry of queue) runCommand(entry, track);
    return queue.length;
  } catch {
    return 0;
  }
}

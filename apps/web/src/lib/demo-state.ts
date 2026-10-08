/** Dev-only `?demo=empty|loading|error` override for previewing page states. Always "normal" in production. */
export type DemoState = "normal" | "empty" | "loading" | "error";

export function demoState(sp: Record<string, string | string[] | undefined>): DemoState {
  if (process.env.NODE_ENV === "production") return "normal";
  const raw = Array.isArray(sp.demo) ? sp.demo[0] : sp.demo;
  return raw === "empty" || raw === "loading" || raw === "error" ? raw : "normal";
}

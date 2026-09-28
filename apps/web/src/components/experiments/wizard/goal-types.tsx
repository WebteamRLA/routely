import { CheckCircle2, Eye } from "lucide-react";

/**
 * How a conversion is defined.
 *
 * A conversion is a visitor reaching the goal URL — the one signal the SDK already reports.
 *
 * Eleven other goal types (wildcard and regex pageviews, custom events, revenue, the click and
 * form goals, element visibility, scroll depth) were listed here marked "Coming soon" until
 * they were removed. Each needs a capability that does not exist: DOM listeners, an
 * intersection observer, a public `routely.track()` call, an order value. None is a matter of
 * reading a different field off an existing event, so the grid advertised eleven things the
 * product cannot do.
 */
export function GoalTypes() {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">How do you define this conversion goal?</p>

      <div className="relative flex gap-3 rounded-lg border border-primary bg-primary/5 p-4 ring-1 ring-primary sm:max-w-sm">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Eye className="size-4" aria-hidden />
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="pr-5 text-sm font-medium">Pageview</p>
          <p className="text-sm text-muted-foreground">Track when users visit a specific URL</p>
        </div>

        <CheckCircle2 className="absolute top-3 right-3 size-4 text-primary" aria-hidden />
      </div>
    </div>
  );
}

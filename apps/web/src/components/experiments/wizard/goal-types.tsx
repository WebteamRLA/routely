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
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-extrabold">Goal type</p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2.5">
        <div
          aria-current="true"
          className="flex gap-2.5 rounded-lg border-[1.5px] border-primary bg-brand-tint px-3.5 py-3 shadow-[0_0_0_3px_rgba(43,89,240,0.14)]"
        >
          <span
            aria-hidden
            className="mt-0.5 size-4 flex-none rounded-full border-2 border-primary bg-primary shadow-[inset_0_0_0_3px_#FFFFFF]"
          />
          <span className="min-w-0">
            <span className="text-[13.5px] font-extrabold">Pageview</span>
            <span className="mt-0.5 block text-[12.5px] text-ink-3">
              Track when users visit a specific URL
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

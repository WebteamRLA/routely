import { Skeleton } from "@/components/ui/skeleton";

/** Title block, then the install-snippet section and the settings section as shimmer blocks. */
export default function WebsiteLoading() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-3.5">
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-7 w-56 max-w-full rounded-md" />
          <Skeleton className="h-4 w-80 max-w-full rounded-md" />
        </div>
        <Skeleton className="h-[38px] w-32 rounded-md" />
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <Skeleton className="h-4 w-40 rounded-sm" />
        </div>
        <div className="p-5">
          <Skeleton className="h-24 w-full" />
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <Skeleton className="h-4 w-32 rounded-sm" />
        </div>
        <div className="flex flex-col gap-3 p-5">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-10 w-full rounded-md" />
          ))}
        </div>
      </section>
    </div>
  );
}

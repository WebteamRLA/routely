import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Brand } from "@/components/layout/brand";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background px-4 py-6 sm:px-6">
      <Brand href={routes.home} />
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-center py-10">
        {/* No icon: the empty state then shows the design's two-block split mark. */}
        <EmptyState
          className="w-full"
          title="Page not found"
          description="The page you were looking for does not exist, or you no longer have access to it."
          action={
            <Button asChild>
              <Link href={routes.experiments.list}>Back to experiments</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}

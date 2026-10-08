import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { EmptyCard } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background px-4 py-6 sm:px-6">
      <Brand href={routes.home} />
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-center py-10">
        <EmptyCard
          className="w-full"
          title="Page not found"
          body="The page you were looking for does not exist, or you no longer have access to it."
          actions={
            <Button asChild>
              <Link href={routes.home}>Back to dashboard</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}

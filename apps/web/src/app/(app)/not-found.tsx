import Link from "next/link";

import { EmptyCard } from "@/components/rl";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/** Not found inside the dashboard chrome: a project or experiment the user does not own. */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <EmptyCard
        title="Page not found"
        body="The page you were looking for does not exist, or you no longer have access to it."
        actions={
          <Button asChild>
            <Link href={routes.home}>Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}

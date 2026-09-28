import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * Who an experiment is shown to.
 *
 * Every experiment runs against all visitors. A list of preset segments — device type, new vs
 * returning, paid/organic/social traffic — sat here marked "Coming soon" until it was removed:
 * each needs a signal Routely does not collect (the SDK never sends device type or referrer,
 * and "new vs returning" needs a visitor's history read before the config request resolves),
 * so the list advertised seven things the product cannot do.
 */

export function AudienceSegments() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-primary bg-primary/5 p-4 ring-1 ring-primary">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Users className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">All Visitors</p>
          <p className="text-sm text-muted-foreground">All the visitors reaching your website.</p>
        </div>
        <Badge>Selected</Badge>
      </div>
    </div>
  );
}

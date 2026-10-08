import { AuthShowcase } from "@/components/auth/auth-showcase";
import { Brand } from "@/components/layout/brand";
import { routes } from "@/lib/routes";

/**
 * Shell for unauthenticated screens.
 *
 * The design's split: a navy product panel on the left that answers "what is this?" for
 * someone arriving cold on an invite link or a bookmark, and the form column on the right.
 *
 * Below the `nav` breakpoint (900px) the panel is not rendered at all and a compact wordmark
 * takes its place above the form. That is deliberate rather than a fallback: on a phone the
 * panel would push the one action the page exists for below the fold.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <AuthShowcase className="hidden nav:flex" />

      <main className="flex min-w-0 flex-[1_1_50%] items-center justify-center px-5 py-10">
        <div className="flex w-full max-w-[400px] flex-col gap-[18px]">
          <Brand href={routes.home} size="lg" className="text-lg nav:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}

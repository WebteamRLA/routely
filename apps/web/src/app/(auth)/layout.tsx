import { BrandMark } from "@/components/layout/brand";
import { LoginShowcase } from "@/components/login/login-showcase";

/**
 * Shell for unauthenticated screens, as the design draws the login overlay: a navy brand panel
 * on the left (desktop only) and the form column on the right, each half the width.
 *
 * Below the `nav` breakpoint (900px) the panel is not rendered and a compact wordmark sits
 * above the form instead, so the one action the page exists for stays above the fold.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <LoginShowcase className="hidden nav:flex" />

      <main className="flex min-w-0 flex-[1_1_50%] items-center justify-center px-5 py-10">
        <div className="flex w-full max-w-[400px] flex-col gap-[18px]">
          <div className="flex items-center gap-2.5 nav:hidden">
            <BrandMark className="size-[22px]" />
            <span className="font-heading text-[18px] font-bold">Routely</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

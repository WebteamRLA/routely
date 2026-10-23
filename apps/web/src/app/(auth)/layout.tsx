/**
 * Shell for unauthenticated screens: none. The sign-in design is a single centred column on
 * white with its own footer, so the page renders the whole viewport itself.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}

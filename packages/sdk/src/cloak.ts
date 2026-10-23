/**
 * Anti-flicker handover.
 *
 * The overlay that hides the page during a redirect decision is **not** created here. It is
 * created by the anti-flickering script the customer pastes into their `<head>`, above the
 * tracking tag — see `buildAntiFlickerSnippet` in the dashboard.
 *
 * That split is deliberate. An inline script in `<head>` runs at parse time with no network
 * request in front of it, so it hides the page earlier than any bundle can; its timeout
 * belongs to the customer's own page, so a blocked or failed bundle can never leave a site
 * blank; and the duration and colour are plain values they can edit, rather than one number
 * baked into a bundle every customer shares.
 *
 * All the SDK does is end the wait early. The snippet publishes `window.__routelyReveal`, and
 * this calls it the moment the decision is known — so in the common case the overlay lasts
 * only as long as the decision took, and the snippet's timeout is a backstop rather than the
 * mechanism.
 *
 * When the overlay lifts depends on what the visitor gets:
 *
 *  - **Control, excluded, untargeted device, or no matching experiment** — immediately, once
 *    the decision is known.
 *  - **Split-URL variant** — never by the SDK: the page is being replaced, and lifting the
 *    overlay would flash the control page during the navigation.
 *  - **A/B variant** — once its visual changes are applied (`apply.ts`), or when the SDK stops
 *    waiting for elements that have not appeared. The snippet's own `routelyTimeout` bounds the
 *    wait either way: the SDK can only lift the overlay earlier, never hold it longer.
 *
 * If the customer has not installed the anti-flickering script, the global is absent and this
 * does nothing at all. That is a supported installation: they get the tracking, and they get
 * the flicker.
 */

interface RevealHost {
  __routelyReveal?: () => void;
}

/**
 * Removes the anti-flicker overlay, if one is present.
 *
 * Never throws: the function belongs to the host page and may have been replaced, removed or
 * defined as something other than a function by the time this runs.
 */
export function revealPage(
  host: unknown = typeof window === "undefined" ? undefined : window,
): void {
  try {
    const reveal = (host as RevealHost | undefined)?.__routelyReveal;
    if (typeof reveal === "function") reveal();
  } catch {
    // A host page that throws from its own reveal function is not something the SDK can fix,
    // and the snippet's timeout will still lift the overlay.
  }
}

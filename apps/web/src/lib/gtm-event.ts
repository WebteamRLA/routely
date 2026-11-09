/**
 * The Google Tag Manager event tag: a click or form event detected from a Custom HTML tag instead
 * of by the Routely pixel (user request 2026-11-10). Pure.
 *
 * It is the same detection as the SDK's (`packages/sdk/src/events.ts`), from the same trigger data
 * (`toEventTrigger`), with the same rules and timings (shared through `@routely/sdk/contract`):
 *
 *  - a click counts with `closest()`, so a click inside the element counts;
 *  - a form counts only once it is confirmed: the browser's own submit that no script cancelled, a
 *    success page reached within 30 minutes of sending the form in this tab, a success message that
 *    goes from hidden to visible within 15 seconds, or the form plugin's success event;
 *  - field values are never read, and nothing is sent but the event name.
 *
 * It reports through `window.routely.track()`, so the visitor, the event id, the offline queue, the
 * server's dedupe and the attribution to an experiment are all the pixel's own. The Routely tracking
 * script must therefore be on the page too (in `<head>` or its own GTM tag); until it loads, calls
 * wait in its standard queue.
 *
 * **Never counted twice.** An event set to GTM is left out of the pixel's configuration, so the pixel
 * does not listen for it (`listTriggers`). The other way round — the event switched back to the
 * pixel with this tag still published — the tag stands down whenever the pixel's cached
 * configuration lists the event. Beneath both: one action is one report within `EVENT_BURST_MS`, the
 * success-page memory is the SDK's own `sessionStorage` key, the server stores an event id once, and
 * a visitor converts at most once per experiment.
 *
 * Plain ES5: older Tag Manager containers refuse newer syntax in Custom HTML.
 */

import {
  CONFIG_CACHE_PREFIX,
  EVENT_BURST_MS,
  type EventTrigger,
  FORM_SUBMITTED_KEY,
  FORM_SUBMIT_MEMORY_MS,
  FORM_SUCCESS_WATCH_MS,
  HANDOFF_PREFIX,
  IGNORED_QUERY_PARAMS,
} from "@routely/sdk/contract";

/** In every event tag, unquoted, so a published container that holds one can be recognised. */
export const EVENT_TAG_MARK = "__routelyEventTags";

/** What the tag needs to know, and nothing else: the trigger's data, never code. */
function tagTrigger(trigger: EventTrigger): EventTrigger {
  const { name, kind, selector, page, success, successUrl, successSelector, successEvent } =
    trigger;
  return {
    name,
    kind,
    ...(selector ? { selector } : {}),
    ...(page ? { page } : {}),
    ...(success ? { success } : {}),
    ...(successUrl ? { successUrl } : {}),
    ...(successSelector ? { successSelector } : {}),
    ...(successEvent ? { successEvent } : {}),
  };
}

/** A JavaScript literal that cannot close the surrounding `<script>`. */
function literal(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}

/** The Custom HTML for one event's Tag Manager tag. */
export function buildGtmEventSnippet({
  publicSiteId,
  trigger,
}: {
  publicSiteId: string;
  trigger: EventTrigger;
}): string {
  const t = tagTrigger(trigger);
  return `<!-- Routely event: ${t.name.replace(/--/g, "-")} (Google Tag Manager: Custom HTML, trigger: All Pages) -->
<script>
(function (w, d) {
  var site = ${literal(publicSiteId)};
  var t = ${literal(t)};
  var seen = w.${EVENT_TAG_MARK} = w.${EVENT_TAG_MARK} || {};
  if (seen[t.name]) return;
  seen[t.name] = 1;

  var SUB = ${literal(FORM_SUBMITTED_KEY)} + t.name, IGNORED = ${literal(IGNORED_QUERY_PARAMS)};
  var now = function () { return new Date().getTime(); };
  var store = function () { try { return w.sessionStorage; } catch (e) { return null; } };
  var key = function (u) {
    try {
      var x = new URL(u, location.href), q = new URLSearchParams();
      if (x.protocol !== "http:" && x.protocol !== "https:") return null;
      x.searchParams.forEach(function (v, k) {
        if (k.indexOf(${literal(HANDOFF_PREFIX)}) !== 0 && IGNORED.indexOf(k.toLowerCase()) < 0) q.append(k, v);
      });
      q.sort();
      var path = x.pathname === "/" ? "" : x.pathname.replace(/\\/$/, ""), s = q.toString();
      return "//" + x.host.toLowerCase() + path + (s ? "?" + s : "");
    } catch (e) { return null; }
  };
  var matches = function (u, rule) {
    var a = key(u), b = key(rule.url);
    if (a === null || b === null) return false;
    if (rule.match === "EXACT") return a === b;
    var rest = a.indexOf(b) === 0 ? a.slice(b.length) : null;
    return rest === "" || (rest !== null && (rest.charAt(0) === "/" || rest.charAt(0) === "?"));
  };
  var within = function (el, sel) {
    try { return !!(el && el.closest && el.closest(sel)); } catch (e) { return false; }
  };
  var shown = function (sel) {
    try { var el = d.querySelector(sel); return !!el && el.getClientRects().length > 0; } catch (e) { return false; }
  };
  // The pixel already listens for this event when its configuration lists it.
  var pixelHas = function () {
    try {
      var c = JSON.parse(store().getItem(${literal(CONFIG_CACHE_PREFIX)} + site));
      var list = (c && c.config && c.config.events) || [];
      for (var i = 0; i < list.length; i++) if (list[i].name === t.name) return true;
    } catch (e) {}
    return false;
  };
  var last = 0;
  var send = function (id) {
    if (now() - last < ${EVENT_BURST_MS} || pixelHas()) return;
    last = now();
    var r = w.routely = w.routely || {};
    if (r.isLoaded && r.siteId && r.siteId !== site) return;
    if (!r.track) { r.q = r.q || []; r.track = function () { this.q.push(arguments); }; }
    try { r.track(t.name, null, id ? { id: id } : null); } catch (e) {}
  };
  var watch = function (sel) {
    if (shown(sel) || !w.MutationObserver) return;
    var o = new MutationObserver(function () { if (shown(sel)) { o.disconnect(); send(); } });
    o.observe(d.documentElement, { childList: true, subtree: true, attributes: true });
    setTimeout(function () { o.disconnect(); }, ${FORM_SUCCESS_WATCH_MS});
  };

  var here = location.href, onPage = !t.page || matches(here, t.page);

  if (t.kind === "click" && t.selector && onPage) {
    d.addEventListener("click", function (e) { if (within(e.target, t.selector)) send(); }, true);
  }
  if (t.kind !== "form") return;

  // Checked before the submission is marked counted, so the pixel's own count is never blocked.
  if (t.success === "url" && t.successUrl && matches(here, t.successUrl) && !pixelHas()) {
    var s = store(), at = NaN;
    try { at = Number(s && s.getItem(SUB)); } catch (e) {}
    if (t.selector ? now() - at < ${FORM_SUBMIT_MEMORY_MS} : !(at < 0)) {
      try { if (s) s.setItem(SUB, "-1"); } catch (e) {}
      send(t.selector ? "gtm-" + at : null);
    }
  }
  if (t.selector && onPage) {
    w.addEventListener("submit", function (e) {
      if (!within(e.target, t.selector)) return;
      if (t.success === "url") { try { store().setItem(SUB, String(now())); } catch (x) {} }
      else if (t.success === "element" && t.successSelector) watch(t.successSelector);
      else if (t.success === "submit" && !e.defaultPrevented) send();
    });
  }
  if (t.success === "callback" && t.successEvent) {
    var heard = function (e) { if (!t.selector || e.target === d || within(e.target, t.selector)) send(); };
    d.addEventListener(t.successEvent, heard);
    try { if (w.jQuery) w.jQuery(d).on(t.successEvent, heard); } catch (e) {}
  }
})(window, document);
</script>`;
}

/** What the server's check found on one page (`inspectEventTag` in `pixel.service.ts`). */
export interface EventTagLook {
  pageLoaded: boolean;
  loadError: string | null;
  /** A refusal of the URL itself, safe to show. */
  refused: string | null;
  /** GTM containers the page loads. */
  containers: string[];
  /** A container could not be fetched. */
  unreadable: boolean;
  /** A published container holds this event's tag. */
  tagPublished: boolean;
  /** This project's Routely tracking script is on the page or in a published container. */
  pixelFound: boolean;
}

export interface EventTagStatus {
  tone: "ok" | "warn" | "fail";
  title: string;
  detail: string;
}

/**
 * The check's answer, in words. It proves the tag is published where the page loads it, not that
 * it fires: the event's own status (an event arriving) is what shows that.
 */
export function eventTagStatus(look: EventTagLook): EventTagStatus {
  if (!look.pageLoaded) {
    return {
      tone: "fail",
      title: "Couldn’t load that page",
      detail: look.refused ?? look.loadError ?? "Check the address and try again.",
    };
  }
  if (look.containers.length === 0) {
    return {
      tone: "fail",
      title: "No Google Tag Manager on this page",
      detail:
        "This page doesn’t load a Google Tag Manager container. Add your container’s code to the site, or check a page that has it.",
    };
  }
  if (!look.tagPublished) {
    return look.unreadable
      ? {
          tone: "warn",
          title: "Couldn’t read your container",
          detail: `Google Tag Manager didn’t return ${look.containers.join(", ")}. Try again in a moment.`,
        }
      : {
          tone: "fail",
          title: "This event’s tag isn’t published",
          detail: `${look.containers.join(", ")} doesn’t have this event’s tag yet. Add it as a Custom HTML tag, then Submit and Publish.`,
        };
  }
  if (!look.pixelFound) {
    return {
      tone: "warn",
      title: "Tag published, Routely script missing",
      detail:
        "The tag reports through the Routely tracking script, which isn’t on this page or in your container. Install it too.",
    };
  }
  return {
    tone: "ok",
    title: "Published in Google Tag Manager",
    detail: "Perform the action on your site. The event’s status changes once Routely receives it.",
  };
}

/** A published container holds this event's tag: the tag's mark and the event's name, quoted. */
export function containerHasEventTag(js: string, name: string): boolean {
  if (!js.includes(EVENT_TAG_MARK)) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quote = String.raw`(?:["']|\\x2[27]|\\u002[27]|\\")`;
  return new RegExp(`${quote}name${quote}\\s*:\\s*${quote}${escaped}${quote}`).test(js);
}

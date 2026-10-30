import { describe, expect, it } from "vitest";

import {
  CACHE_BUSTER_PARAM,
  type PageLook,
  cacheState,
  combineLooks,
  withCacheBuster,
} from "@/lib/install-check";
import { detectSnippet } from "@/lib/snippet-detect";

const ID = "rt_7ff45706623e1a258485cd35fb885a68";
const OLD = "rt_3fa03690fd42303a68d5f127392cb046";
const page = (id: string | null) =>
  id ? `<head><script async src="/sdk.js" data-site-id="${id}"></script></head>` : "<head></head>";
const look = (id: string | null, cache: PageLook["cache"], loaded = true): PageLook => ({
  loaded,
  detection: detectSnippet(page(id), ID),
  cache,
});

describe("cacheState", () => {
  it("reads host, LiteSpeed and CDN cache headers", () => {
    expect(cacheState({ "x-cache": "HIT", "cf-cache-status": "DYNAMIC" })).toBe("hit");
    expect(cacheState({ "x-cache": "BYPASS", "cf-cache-status": "DYNAMIC" })).toBe("miss");
    expect(cacheState({ "x-litespeed-cache": "hit" })).toBe("hit");
    expect(cacheState({ "x-litespeed-cache": "miss" })).toBe("miss");
    expect(cacheState({ "cf-cache-status": "HIT" })).toBe("hit");
    expect(cacheState({ "x-cache": "MISS, HIT" })).toBe("hit");
    expect(cacheState({ age: "120" })).toBe("hit");
    expect(cacheState({ age: "0" })).toBe("unknown");
    expect(cacheState({})).toBe("unknown");
  });
});

describe("withCacheBuster", () => {
  it("adds its own parameter and keeps the page's query and fragment", () => {
    expect(withCacheBuster("https://acme.com/p?a=1#f", 7)).toBe(
      `https://acme.com/p?a=1&${CACHE_BUSTER_PARAM}=7#f`,
    );
    expect(withCacheBuster("not a url", 7)).toBe("not a url");
  });
});

describe("combineLooks", () => {
  it("is installed when visitors' copy has this project's code", () => {
    expect(combineLooks(look(ID, "hit"), null)).toMatchObject({
      scriptFound: true,
      staleCache: false,
    });
  });

  it("is installed past a stale server cache — niftyit-staging.wp1.sh on 2026-10-30", () => {
    // Served: x-cache HIT with an older snippet. Fresh: x-cache BYPASS with this project's.
    expect(combineLooks(look(OLD, "hit"), look(ID, "miss"))).toMatchObject({
      scriptFound: true,
      staleCache: true,
      wrongSiteId: false,
    });
    // A cache with no Routely code at all, WordPress with it: same.
    expect(combineLooks(look(null, "hit"), look(ID, "miss")).staleCache).toBe(true);
  });

  it("never counts another project's code as installed — confirmed when no cache answered", () => {
    const genuine = combineLooks(look(OLD, "hit"), look(OLD, "miss"));
    expect(genuine).toMatchObject({
      scriptFound: false,
      wrongSiteId: true,
      mismatchConfirmed: true,
      otherSiteIds: [OLD],
    });
  });

  it("does not call a mismatch genuine when every copy came from a cache", () => {
    expect(combineLooks(look(OLD, "hit"), look(OLD, "hit"))).toMatchObject({
      scriptFound: false,
      wrongSiteId: true,
      mismatchConfirmed: false,
    });
    // The fresh look failed to load: only the cached copy is known.
    expect(combineLooks(look(OLD, "hit"), look(null, "unknown", false)).mismatchConfirmed).toBe(
      false,
    );
  });

  it("is missing when WordPress has no Routely code, even if a cache still has an old one", () => {
    expect(combineLooks(look(OLD, "hit"), look(null, "miss"))).toMatchObject({
      scriptFound: false,
      wrongSiteId: false,
    });
  });

  it("flags this project's code next to another project's", () => {
    const both = `<script data-site-id="${OLD}"></script><script data-site-id="${ID}"></script>`;
    const finding = combineLooks(
      { loaded: true, detection: detectSnippet(both, ID), cache: "miss" },
      null,
    );
    expect(finding).toMatchObject({ scriptFound: true, alsoOtherProject: true });
  });
});

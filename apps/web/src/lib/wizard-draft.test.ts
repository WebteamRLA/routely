import { describe, expect, it } from "vitest";

import { type EventStatus } from "@/lib/events";
import {
  draftPatch as abDraftPatch,
  emptyForm as abEmptyForm,
  formFromDraft as abFormFromDraft,
  initState as abInitState,
  trackKey as abTrackKey,
  validate as abValidate,
} from "@/lib/mock/ab-test";
import {
  draftPatch as splitDraftPatch,
  emptyForm as splitEmptyForm,
  formFromDraft as splitFormFromDraft,
  initState as splitInitState,
  trackKey as splitTrackKey,
  validate as splitValidate,
} from "@/lib/mock/split-url";
import {
  URL_GOAL,
  devicesFromFlags,
  eventGoalLabel,
  flagsFromDevices,
  goalFromDraft,
  goalPatch,
  resumeStep,
  savedAtPhrase,
  savedLabelFor,
  trackingFromChecks,
  typedInt,
  wizardEvents,
} from "@/lib/wizard-draft";

const now = new Date("2026-10-19T15:00:00Z");

describe("saved labels", () => {
  it("reads today / yesterday / a date, in UTC", () => {
    expect(savedLabelFor(new Date("2026-10-19T01:00:00Z"), now)).toBe("Draft saved");
    expect(savedLabelFor(new Date("2026-10-18T23:59:00Z"), now)).toBe("Draft saved yesterday");
    expect(savedLabelFor(new Date("2026-10-09T14:48:00Z"), now)).toBe("Draft saved Oct 9");
    expect(savedAtPhrase(new Date("2026-10-09T14:48:00Z"), now)).toBe("Oct 9 at 2:48 PM");
    expect(savedAtPhrase(new Date("2026-10-18T16:05:00Z"), now)).toBe("yesterday at 4:05 PM");
  });
});

describe("resumeStep", () => {
  it("reopens where the draft was left, but not past the first step with a problem", () => {
    expect(resumeStep(4, [])).toBe(4);
    expect(resumeStep(5, [{ step: 2, field: "split", message: "" }])).toBe(2);
    expect(resumeStep(0, [])).toBe(1);
    expect(resumeStep(9, [])).toBe(5);
  });
});

describe("devices", () => {
  it("round-trips between the wizard's flags and stored devices", () => {
    const flags = { desktop: true, mobile: false, tablet: true };
    expect(devicesFromFlags("specific", flags)).toEqual(["DESKTOP", "TABLET"]);
    expect(devicesFromFlags("all", flags)).toEqual([]);
    expect(flagsFromDevices(["TABLET", "DESKTOP"])).toEqual({
      targeting: "specific",
      devices: flags,
    });
    // All three is the same as everyone.
    expect(flagsFromDevices(["DESKTOP", "MOBILE", "TABLET"]).targeting).toBe("all");
  });

  it("reads typed percentages", () => {
    expect(typedInt("40")).toBe(40);
    expect(typedInt("")).toBeNull();
    expect(typedInt(undefined)).toBeNull();
  });
});

describe("trackingFromChecks", () => {
  const pages = [
    { id: "page", url: "acme.com/" },
    { id: "goal", url: "https://acme.com/thanks/" },
  ];

  it("maps each page to its check by normalised URL", () => {
    expect(
      trackingFromChecks(pages, [
        { urlKey: "https://acme.com", result: "OK" },
        { urlKey: "https://acme.com/thanks", result: "MISSING" },
      ]),
    ).toEqual({ status: "done", results: { page: "ok", goal: "missing" }, details: {} });
  });

  it("keeps the reason a page is missing", () => {
    expect(
      trackingFromChecks(pages, [
        { urlKey: "https://acme.com", result: "OK" },
        { urlKey: "https://acme.com/thanks", result: "MISSING", detail: "Wrong project." },
      ]),
    ).toEqual({
      status: "done",
      results: { page: "ok", goal: "missing" },
      details: { goal: "Wrong project." },
    });
  });

  it("skips a page with no URL yet instead of failing the whole check", () => {
    const noGoal = [pages[0]!, { id: "goal", url: "" }];
    expect(trackingFromChecks(noGoal, [{ urlKey: "https://acme.com", result: "OK" }])).toEqual({
      status: "done",
      results: { page: "ok" },
      details: {},
    });
  });

  it("is an error when any page couldn't be checked", () => {
    expect(
      trackingFromChecks(pages, [
        { urlKey: "https://acme.com", result: "OK" },
        { urlKey: "https://acme.com/thanks", result: "ERROR" },
      ]),
    ).toEqual({ status: "error" });
    expect(trackingFromChecks(pages, [{ urlKey: "https://acme.com", result: "OK" }])).toEqual({
      status: "error",
    });
  });
});

describe("the goal on a draft", () => {
  const status: EventStatus = { state: "active", label: "Active", note: "", tone: "ok" };
  const eventGoal = { goalType: "EVENT", goalEventId: "ev1", goalEventName: "signup" } as const;

  it("reads a stored goal, and treats anything else as a page goal", () => {
    expect(goalFromDraft({})).toEqual(URL_GOAL);
    expect(goalFromDraft({ goalType: "URL", goalEventId: "ev1" })).toEqual(URL_GOAL);
    expect(
      goalFromDraft({ goalType: "EVENT", goalEventId: "ev1", goalEvent: { name: "signup" } }),
    ).toEqual(eventGoal);
    // The event was deleted: the goal is still an event, with none chosen.
    expect(goalFromDraft({ goalType: "EVENT", goalEventId: null, goalEvent: null })).toEqual({
      goalType: "EVENT",
      goalEventId: null,
      goalEventName: null,
    });
  });

  it("stores an event only on an event goal", () => {
    expect(goalPatch(eventGoal)).toEqual({ goalType: "EVENT", goalEventId: "ev1" });
    expect(goalPatch({ ...eventGoal, goalType: "URL" })).toEqual({
      goalType: "URL",
      goalEventId: null,
    });
  });

  it("labels the goal for reviews and summaries", () => {
    expect(eventGoalLabel(eventGoal)).toBe("Event: signup");
    expect(eventGoalLabel(URL_GOAL)).toBe("No event chosen yet");
  });

  it("offers only configured events", () => {
    const rows = [
      { id: "ev1", name: "signup", method: "CODE" as const, status },
      { id: null, name: "undeclared", method: null, status },
    ];
    expect(wizardEvents(rows).map((event) => event.name)).toEqual(["signup"]);
  });

  it("starts every form, the seeded design states included, on a page goal", () => {
    expect(splitEmptyForm()).toMatchObject(URL_GOAL);
    expect(abEmptyForm()).toMatchObject(URL_GOAL);
    expect(splitInitState("goal").form).toMatchObject(URL_GOAL);
    expect(abInitState("goal").form).toMatchObject(URL_GOAL);
  });

  it("round-trips through both wizards' drafts", () => {
    const row = {
      name: "Test",
      controlUrl: "https://acme.com/",
      conversionUrl: null,
      goalType: "EVENT",
      goalEventId: "ev1",
      goalEvent: { name: "signup" },
      keepQueryParams: false,
      trafficAllocation: 100,
      controlWeight: 100,
      targetDevices: [],
      variants: [],
    } as const;
    const split = splitFormFromDraft(row);
    const ab = abFormFromDraft(row);
    expect(split).toMatchObject(eventGoal);
    expect(ab).toMatchObject(eventGoal);
    expect(splitDraftPatch(split, 4, () => undefined)).toMatchObject({
      goalType: "EVENT",
      goalEventId: "ev1",
      conversionUrl: null,
    });
    expect(abDraftPatch(ab, 4, () => undefined)).toMatchObject({
      goalType: "EVENT",
      goalEventId: "ev1",
    });
  });

  it("judges step 4 by the goal type, in both wizards", () => {
    const blank = { ...URL_GOAL, goalType: "EVENT" } as const;
    const splitErrs = splitValidate({ ...splitEmptyForm(), ...blank }, "acme.com")[4];
    const abErrs = abValidate({ ...abEmptyForm(), ...blank }, "acme.com")[4];
    for (const errs of [splitErrs, abErrs]) {
      expect(errs).toEqual({
        url: "",
        event: "Choose the event that counts as a conversion.",
        count: 1,
      });
    }
    expect(splitValidate({ ...splitEmptyForm(), ...eventGoal }, "acme.com")[4].count).toBe(0);
    expect(abValidate({ ...abEmptyForm(), ...eventGoal }, "acme.com")[4].count).toBe(0);
    expect(splitValidate(splitEmptyForm(), "acme.com")[4]).toMatchObject({
      event: "",
      count: 1,
    });
  });

  it("makes a tracking check stale when the goal type changes, and only then", () => {
    const split = { ...splitEmptyForm(), goalUrl: "https://acme.com/thanks" };
    const ab = { ...abEmptyForm(), goalUrl: "https://acme.com/thanks" };
    expect(splitTrackKey({ ...split, ...eventGoal })).not.toBe(splitTrackKey(split));
    expect(abTrackKey({ ...ab, ...eventGoal })).not.toBe(abTrackKey(ab));
    // An event goal has no page, so a leftover URL can't make its check stale.
    expect(splitTrackKey({ ...split, ...eventGoal })).toBe(
      splitTrackKey({ ...split, ...eventGoal, goalUrl: "https://acme.com/other" }),
    );
  });
});

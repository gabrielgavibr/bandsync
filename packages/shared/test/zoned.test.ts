import { describe, expect, it } from "vitest";
import {
  addDays,
  isValidTimeZone,
  localParts,
  nextWeeklyDates,
  weekdayOf,
  zonedToUtc,
} from "../src/time/zoned";

describe("wall-clock time in a named zone", () => {
  it("19:00 in São Paulo on 10/11/2026 is 22:00 UTC", () => {
    expect(zonedToUtc("2026-11-10", "19:00", "America/Sao_Paulo").toISOString()).toBe(
      "2026-11-10T22:00:00.000Z",
    );
  });

  it("reads an instant back as the clock on the wall", () => {
    const p = localParts(new Date("2026-11-10T22:00:00Z"), "America/Sao_Paulo");
    expect(p).toEqual({ date: "2026-11-10", time: "19:00", weekday: 2 });
    // Late evening in UTC is still the same day in Brasília; early UTC morning is the day before.
    expect(localParts(new Date("2026-11-11T01:30:00Z"), "America/Sao_Paulo").date).toBe(
      "2026-11-10",
    );
  });

  it("keeps the hour on the wall across a change of offset", () => {
    // New York: daylight time ends on 1 November 2026.
    expect(zonedToUtc("2026-10-27", "19:00", "America/New_York").toISOString()).toBe(
      "2026-10-27T23:00:00.000Z",
    );
    expect(zonedToUtc("2026-11-03", "19:00", "America/New_York").toISOString()).toBe(
      "2026-11-04T00:00:00.000Z",
    );
    expect(zonedToUtc("2026-07-01", "09:30", "Europe/Lisbon").toISOString()).toBe(
      "2026-07-01T08:30:00.000Z",
    );
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("America/Sao_Paulo")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("weekly series", () => {
  it("10/11/2026 is a Tuesday", () => {
    expect(weekdayOf("2026-11-10")).toBe(2);
    expect(addDays("2026-11-10", 7)).toBe("2026-11-17");
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
  });

  it("lists the next dates without going before the start or the reference day", () => {
    expect(nextWeeklyDates("2026-11-10", 2, "2026-11-10", 3)).toEqual([
      "2026-11-10",
      "2026-11-17",
      "2026-11-24",
    ]);
    expect(nextWeeklyDates("2026-11-10", 2, "2026-11-11", 2)).toEqual(["2026-11-17", "2026-11-24"]);
    expect(nextWeeklyDates("2026-11-10", 2, "2026-10-01", 1)).toEqual(["2026-11-10"]);
    // A start date that is not on the weekday: the first one after it.
    expect(nextWeeklyDates("2026-11-11", 2, "2026-11-01", 1)).toEqual(["2026-11-17"]);
    expect(nextWeeklyDates("2026-11-10", 2, "2027-06-01", 1)).toEqual(["2027-06-01"]);
  });
});

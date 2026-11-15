import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  assertTimeZone,
  daysBetween,
  endOfDay,
  isCalendarDate,
  isoDate,
  isTimeZone,
  zonedDateTime,
  zonedParts,
} from "../../server/time.ts";

// The DST tests are ported from Hangry (free-now) test/lib/time-dst.test.ts.

const BERLIN = "Europe/Berlin";
const NEW_YORK = "America/New_York";
const SYDNEY = "Australia/Sydney";

const HOUR_MS = 3_600_000;
const SLOT_MS = 15 * 60_000;

type Transition = {
  name: string;
  tz: string;
  day: string;
  kind: "spring" | "fall";
  /** Offset in hours before and after the change. */
  before: number;
  after: number;
  /** A normal time before and after the change, with its exact UTC instant. */
  normalBefore: [string, string];
  normalAfter: [string, string];
  /** Wall clocks that do not exist (spring) or happen twice (fall). */
  odd: string[];
};

const TRANSITIONS: Transition[] = [
  {
    name: "Berlin spring forward",
    tz: BERLIN,
    day: "2026-03-29",
    kind: "spring",
    before: 1,
    after: 2,
    normalBefore: ["01:00", "2026-03-29T00:00:00Z"],
    normalAfter: ["04:00", "2026-03-29T02:00:00Z"],
    odd: ["02:00", "02:15", "02:30", "02:45"],
  },
  {
    name: "Berlin fall back",
    tz: BERLIN,
    day: "2026-10-25",
    kind: "fall",
    before: 2,
    after: 1,
    normalBefore: ["01:00", "2026-10-24T23:00:00Z"],
    normalAfter: ["04:00", "2026-10-25T03:00:00Z"],
    odd: ["02:00", "02:15", "02:30", "02:45"],
  },
  {
    name: "New York spring forward",
    tz: NEW_YORK,
    day: "2026-03-08",
    kind: "spring",
    before: -5,
    after: -4,
    normalBefore: ["01:00", "2026-03-08T06:00:00Z"],
    normalAfter: ["04:00", "2026-03-08T08:00:00Z"],
    odd: ["02:00", "02:15", "02:30", "02:45"],
  },
  {
    name: "New York fall back",
    tz: NEW_YORK,
    day: "2026-11-01",
    kind: "fall",
    before: -4,
    after: -5,
    normalBefore: ["00:30", "2026-11-01T04:30:00Z"],
    normalAfter: ["03:00", "2026-11-01T08:00:00Z"],
    odd: ["01:00", "01:15", "01:30", "01:45"],
  },
  {
    name: "Sydney spring forward",
    tz: SYDNEY,
    day: "2026-10-04",
    kind: "spring",
    before: 10,
    after: 11,
    normalBefore: ["01:00", "2026-10-03T15:00:00Z"],
    normalAfter: ["04:00", "2026-10-03T17:00:00Z"],
    odd: ["02:00", "02:15", "02:30", "02:45"],
  },
  {
    name: "Sydney fall back",
    tz: SYDNEY,
    day: "2026-04-05",
    kind: "fall",
    before: 11,
    after: 10,
    normalBefore: ["01:00", "2026-04-04T14:00:00Z"],
    normalAfter: ["04:00", "2026-04-04T18:00:00Z"],
    odd: ["02:00", "02:15", "02:30", "02:45"],
  },
];

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

const pad = (n: number) => String(n).padStart(2, "0");

/** Every 15-minute wall clock of a day: 00:00, 00:15, ... 23:45. */
const SLOTS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

/** UTC instant for a wall clock at a fixed offset, ignoring any zone rules. */
function plainOffset(day: string, hhmm: string, offsetHours: number): number {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  return Date.UTC(year, month - 1, date, hour, minute) - offsetHours * HOUR_MS;
}

/**
 * How many times each 15-minute wall clock happens on `day` in `tz`, found by walking
 * real UTC instants with Intl, so it does not depend on zonedDateTime at all.
 */
function wallCounts(day: string, tz: string): Map<string, number> {
  const counts = new Map<string, number>();
  const start = Date.parse(`${addDays(day, -1)}T00:00:00Z`);
  const end = Date.parse(`${addDays(day, 2)}T00:00:00Z`);
  for (let ms = start; ms < end; ms += SLOT_MS) {
    if (isoDate(ms, tz) !== day) continue;
    const parts = zonedParts(ms, tz);
    const label = `${pad(parts.hour)}:${pad(parts.minute)}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

for (const t of TRANSITIONS) {
  test(`${t.name} ${t.day}: normal times before and after`, () => {
    assert.equal(iso(zonedDateTime(t.day, t.normalBefore[0], t.tz)), t.normalBefore[1]);
    assert.equal(iso(zonedDateTime(t.day, t.normalAfter[0], t.tz)), t.normalAfter[1]);
    assert.equal(zonedDateTime(t.day, t.normalBefore[0], t.tz), plainOffset(t.day, t.normalBefore[0], t.before));
    assert.equal(zonedDateTime(t.day, t.normalAfter[0], t.tz), plainOffset(t.day, t.normalAfter[0], t.after));
  });

  test(`${t.name} ${t.day}: the odd slots are exactly the expected ones`, () => {
    const counts = wallCounts(t.day, t.tz);
    const expected = t.kind === "spring" ? 0 : 2;
    const odd = SLOTS.filter((slot) => (counts.get(slot) ?? 0) !== 1);
    assert.deepEqual(odd, t.odd);
    for (const slot of t.odd) assert.equal(counts.get(slot) ?? 0, expected, slot);
  });

  if (t.kind === "spring") {
    test(`${t.name} ${t.day}: every gap slot uses the offset before the gap`, () => {
      for (const slot of t.odd) {
        assert.equal(iso(zonedDateTime(t.day, slot, t.tz)), iso(plainOffset(t.day, slot, t.before)), slot);
        // RFC 5545: the wall clock moves forward by the gap, so 02:30 reads as 03:30.
        const parts = zonedParts(zonedDateTime(t.day, slot, t.tz), t.tz);
        const [hour, minute] = slot.split(":").map(Number);
        assert.deepEqual([parts.hour, parts.minute], [hour + (t.after - t.before), minute], slot);
      }
    });
  } else {
    test(`${t.name} ${t.day}: every repeated slot is the first occurrence`, () => {
      for (const slot of t.odd) {
        const got = zonedDateTime(t.day, slot, t.tz);
        assert.equal(iso(got), iso(plainOffset(t.day, slot, t.before)), slot);
        // The second occurrence is one hour later and must not be chosen.
        assert.ok(got < plainOffset(t.day, slot, t.after), slot);
      }
    });
  }

  test(`${t.name} ${t.day}: existing slots round-trip and the day is monotonic`, () => {
    const counts = wallCounts(t.day, t.tz);
    let previous = -Infinity;
    for (const slot of [...SLOTS, "23:59"]) {
      // Gap slots are skipped: with the before-gap offset, 02:30 lands on 03:30
      // local, which is later than the real 03:00, so they cannot be monotonic.
      if (slot !== "23:59" && (counts.get(slot) ?? 0) === 0) continue;
      const ms = zonedDateTime(t.day, slot, t.tz);
      if (!(ms > previous)) assert.fail(`${slot} went backwards: ${iso(ms)} <= ${iso(previous)}`);
      previous = ms;
      const parts = zonedParts(ms, t.tz);
      assert.equal(isoDate(ms, t.tz), t.day, slot);
      assert.equal(`${pad(parts.hour)}:${pad(parts.minute)}`, slot);
    }
  });

  test(`${t.name} ${t.day}: day window 06:00 and 23:59 match plain offsets`, () => {
    // Both ends are after the change.
    const start = zonedDateTime(t.day, "06:00", t.tz);
    const end = zonedDateTime(t.day, "23:59", t.tz);
    assert.equal(start, plainOffset(t.day, "06:00", t.after));
    assert.equal(end, plainOffset(t.day, "23:59", t.after));
    assert.equal(end - start, 17 * HOUR_MS + 59 * 60_000);
  });
}

test("DST spot checks", () => {
  assert.equal(iso(zonedDateTime("2026-03-29", "02:30", BERLIN)), "2026-03-29T01:30:00Z");
  assert.equal(iso(zonedDateTime("2026-03-08", "02:30", NEW_YORK)), "2026-03-08T07:30:00Z");
  assert.equal(iso(zonedDateTime("2026-10-04", "02:30", SYDNEY)), "2026-10-03T16:30:00Z");
  assert.equal(iso(zonedDateTime("2026-10-25", "02:30", BERLIN)), "2026-10-25T00:30:00Z");
  assert.equal(iso(zonedDateTime("2026-11-01", "01:30", NEW_YORK)), "2026-11-01T05:30:00Z");
  assert.equal(iso(zonedDateTime("2026-04-05", "02:30", SYDNEY)), "2026-04-04T15:30:00Z");
});

test("DST day window literal instants", () => {
  const windows: [string, string, string, string][] = [
    [BERLIN, "2026-03-29", "2026-03-29T04:00:00Z", "2026-03-29T21:59:00Z"],
    [BERLIN, "2026-10-25", "2026-10-25T05:00:00Z", "2026-10-25T22:59:00Z"],
    [NEW_YORK, "2026-03-08", "2026-03-08T10:00:00Z", "2026-03-09T03:59:00Z"],
    [NEW_YORK, "2026-11-01", "2026-11-01T11:00:00Z", "2026-11-02T04:59:00Z"],
    [SYDNEY, "2026-10-04", "2026-10-03T19:00:00Z", "2026-10-04T12:59:00Z"],
    [SYDNEY, "2026-04-05", "2026-04-04T20:00:00Z", "2026-04-05T13:59:00Z"],
  ];
  for (const [tz, day, start, end] of windows) {
    assert.equal(iso(zonedDateTime(day, "06:00", tz)), start, `${tz} ${day} 06:00`);
    assert.equal(iso(zonedDateTime(day, "23:59", tz)), end, `${tz} ${day} 23:59`);
  }
});

test("zonedDateTime rejects a bad clock time", () => {
  for (const bad of ["", "9:30", "24:00", "12:60", "ab:cd", "12:30:00", "1230"]) {
    assert.throws(() => zonedDateTime("2026-06-01", bad, BERLIN), /bad time/, bad);
  }
  assert.doesNotThrow(() => zonedDateTime("2026-06-01", "23:59", BERLIN));
  assert.doesNotThrow(() => zonedDateTime("2026-06-01", "00:00", BERLIN));
});

test("isoDate and zonedParts read the wall clock of the zone", () => {
  const ms = Date.parse("2026-06-01T22:30:00Z");
  assert.equal(isoDate(ms, "UTC"), "2026-06-01");
  assert.equal(isoDate(ms, BERLIN), "2026-06-02");
  assert.equal(isoDate(ms, NEW_YORK), "2026-06-01");
  assert.deepEqual(zonedParts(ms, BERLIN), { year: 2026, month: 6, day: 2, hour: 0, minute: 30 });
});

test("zonedParts reports midnight as hour 0, never 24", () => {
  const ms = Date.parse("2026-06-01T22:00:00Z");
  assert.equal(zonedParts(ms, BERLIN).hour, 0);
});

test("isCalendarDate: real days", () => {
  assert.equal(isCalendarDate("2026-11-15"), true);
  assert.equal(isCalendarDate("2026-12-31"), true);
  assert.equal(isCalendarDate("2026-01-01"), true);
});

test("isCalendarDate: Feb 29 in leap and non-leap years", () => {
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("2000-02-29"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2100-02-29"), false);
  assert.equal(isCalendarDate("2026-02-30"), false);
});

test("isCalendarDate: bad months, days and shapes", () => {
  assert.equal(isCalendarDate("2026-13-01"), false);
  assert.equal(isCalendarDate("2026-00-10"), false);
  assert.equal(isCalendarDate("2026-04-31"), false);
  assert.equal(isCalendarDate("2026-04-00"), false);
  assert.equal(isCalendarDate("2026-4-5"), false);
  assert.equal(isCalendarDate("26-04-05"), false);
  assert.equal(isCalendarDate("2026-04-05T00:00"), false);
  assert.equal(isCalendarDate(" 2026-04-05"), false);
  assert.equal(isCalendarDate(""), false);
});

test("addDays across month, year and leap day", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-06-15", 0), "2026-06-15");
  assert.equal(addDays("2026-01-01", 365), "2027-01-01");
  assert.equal(addDays("2026-01-01", -365), "2025-01-01");
});

test("addDays is not shifted by DST weeks", () => {
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
});

test("daysBetween", () => {
  assert.equal(daysBetween("2026-11-15", "2026-11-15"), 0);
  assert.equal(daysBetween("2026-11-15", "2026-11-16"), 1);
  assert.equal(daysBetween("2026-11-16", "2026-11-15"), -1);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2);
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
  assert.equal(daysBetween("2026-01-01", "2027-01-01"), 365);
});

test("daysBetween counts whole days across a DST change", () => {
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
});

test("isTimeZone and assertTimeZone", () => {
  assert.equal(isTimeZone("Europe/Berlin"), true);
  assert.equal(isTimeZone("UTC"), true);
  assert.equal(isTimeZone("Mars/Olympus"), false);
  assert.equal(isTimeZone(""), false);
  assert.doesNotThrow(() => assertTimeZone("America/New_York"));
  assert.throws(() => assertTimeZone("Mars/Olympus"), /Invalid APP_TZ: Mars\/Olympus/);
  assert.throws(() => assertTimeZone("nope", "TZ"), /Invalid TZ: nope/);
});

test("endOfDay is one ms before the next local midnight", () => {
  assert.equal(iso(endOfDay("2026-06-01", "UTC") + 1), "2026-06-02T00:00:00Z");
  assert.equal(iso(endOfDay("2026-06-01", BERLIN) + 1), "2026-06-01T22:00:00Z");
  assert.equal(isoDate(endOfDay("2026-06-01", BERLIN), BERLIN), "2026-06-01");
  assert.equal(isoDate(endOfDay("2026-06-01", BERLIN) + 1, BERLIN), "2026-06-02");
});

test("endOfDay on a 23-hour and a 25-hour day", () => {
  // Berlin spring forward: 23 hours long.
  const springStart = zonedDateTime("2026-03-29", "00:00", BERLIN);
  assert.equal(endOfDay("2026-03-29", BERLIN) + 1 - springStart, 23 * HOUR_MS);
  // Berlin fall back: 25 hours long.
  const fallStart = zonedDateTime("2026-10-25", "00:00", BERLIN);
  assert.equal(endOfDay("2026-10-25", BERLIN) + 1 - fallStart, 25 * HOUR_MS);
  // Still the same local day at the last millisecond.
  assert.equal(isoDate(endOfDay("2026-10-25", BERLIN), BERLIN), "2026-10-25");
});

/**
 * Wall-clock times in a named time zone.
 *
 * A rehearsal "every Tuesday at 19:00 in São Paulo" is stored as what the band means (weekday,
 * local time, IANA zone); the instant in UTC is worked out per date, so a change in a zone's
 * offset (daylight saving, where it exists) moves the instant and not the hour on the wall.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24 h) */
  time: string;
  /** 0 = Sunday .. 6 = Saturday */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** What the clock on the wall shows in `timeZone` at `instant`. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

function wallAsUtc(date: string, time: string): number {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) throw new RangeError(`invalid local date/time: ${date} ${time}`);
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
}

/** The instant at which the wall clock in `timeZone` shows `date` `time`. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const wall = wallAsUtc(date, time);
  let guess = wall;
  // Two rounds settle the offset, including dates next to a change of offset.
  for (let i = 0; i < 2; i += 1) {
    const shown = localParts(new Date(guess), timeZone);
    guess += wall - wallAsUtc(shown.date, shown.time);
  }
  return new Date(guess);
}

export function weekdayOf(date: string): number {
  return new Date(wallAsUtc(date, "00:00")).getUTCDay();
}

export function addDays(date: string, days: number): string {
  return new Date(wallAsUtc(date, "00:00") + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The next `count` dates of a weekly series: on `weekday`, not before `startDate`, not before
 * `fromDate`. Nothing is stored for the dates after those: the series is a rule, not a list.
 */
export function nextWeeklyDates(
  startDate: string,
  weekday: number,
  fromDate: string,
  count: number,
): string[] {
  let first = startDate > fromDate ? startDate : fromDate;
  first = addDays(first, (weekday - weekdayOf(first) + 7) % 7);
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(first, i * 7));
}

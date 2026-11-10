import type { OccurrenceDto } from "@bandsync/shared";

/** "terça-feira, 10 de novembro de 2026 · 19:00" in the rehearsal's own time zone. */
export function occurrenceWhen(o: OccurrenceDto, locale: string): string {
  const d = new Date(o.startsAt);
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: o.timezone,
  }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: o.timezone,
  }).format(d);
  return `${date} · ${time}`;
}

export function shortWhen(o: OccurrenceDto, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: o.timezone,
  }).format(new Date(o.startsAt));
}

export function isToday(o: OccurrenceDto, now = new Date()): boolean {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: o.timezone }).format(d);
  return day(new Date(o.startsAt)) === day(now);
}

/** Zone name for people: "America/Sao_Paulo" → "Sao Paulo". */
export const zoneLabel = (tz: string) => (tz.split("/").pop() ?? tz).replace(/_/g, " ");

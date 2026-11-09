/** Locale-aware formatting helpers. Instants are stored in UTC and converted for display. */
export function formatDate(
  iso: string | number | Date,
  locale: string,
  timeZone?: string | null,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: timeZone ?? undefined,
  }).format(new Date(iso));
}

export function formatDateTime(
  iso: string | number | Date,
  locale: string,
  timeZone?: string | null,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timeZone ?? undefined,
  }).format(new Date(iso));
}

export function formatTime(
  iso: string | number | Date,
  locale: string,
  timeZone?: string | null,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeStyle: "short",
    timeZone: timeZone ?? undefined,
  }).format(new Date(iso));
}

export function formatNumber(
  n: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(n);
}

export function formatRelative(
  iso: string | number | Date,
  locale: string,
  now = Date.now(),
): string {
  const diffMs = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return rtf.format(Math.round(diffMs / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  return rtf.format(Math.round(diffMs / 86_400_000), "day");
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

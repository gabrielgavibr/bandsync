export const nowIso = (): string => new Date().toISOString();
export const addMs = (ms: number, from = Date.now()): string => new Date(from + ms).toISOString();
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

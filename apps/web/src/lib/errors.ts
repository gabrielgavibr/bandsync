import i18next from "i18next";
import { ApiError } from "./api";

/** The stable code of an error, or `internal_error` for anything that is not an API error. */
export function errorCodeOf(err: unknown): string {
  return err instanceof ApiError ? err.code : "internal_error";
}

/**
 * The message a person reads for an error. Never an internal key: a code without a translation
 * (for example one added on the server after this page was loaded) falls back to the generic
 * message in the current language.
 */
export function errorText(err: unknown): string {
  return errorTextFor(errorCodeOf(err));
}

export function errorTextFor(code: string): string {
  const key = `common:errors.${code}`;
  return i18next.exists(key) ? i18next.t(key) : i18next.t("common:errors.internal_error");
}

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@bandsync/shared";
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import enAuth from "../locales/en/auth.json";
import enAutoArrange from "../locales/en/autoarrange.json";
import enBand from "../locales/en/band.json";
import enCommon from "../locales/en/common.json";
import enProfile from "../locales/en/profile.json";
import enRehearsal from "../locales/en/rehearsal.json";
import enRepertoire from "../locales/en/repertoire.json";
import enTools from "../locales/en/tools.json";
import ptAuth from "../locales/pt-BR/auth.json";
import ptAutoArrange from "../locales/pt-BR/autoarrange.json";
import ptBand from "../locales/pt-BR/band.json";
import ptCommon from "../locales/pt-BR/common.json";
import ptProfile from "../locales/pt-BR/profile.json";
import ptRehearsal from "../locales/pt-BR/rehearsal.json";
import ptRepertoire from "../locales/pt-BR/repertoire.json";
import ptTools from "../locales/pt-BR/tools.json";

export const NAMESPACES = [
  "common",
  "auth",
  "band",
  "repertoire",
  "rehearsal",
  "tools",
  "profile",
  "autoarrange",
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    band: enBand,
    repertoire: enRepertoire,
    rehearsal: enRehearsal,
    tools: enTools,
    profile: enProfile,
    autoarrange: enAutoArrange,
  },
  "pt-BR": {
    common: ptCommon,
    auth: ptAuth,
    band: ptBand,
    repertoire: ptRepertoire,
    rehearsal: ptRehearsal,
    tools: ptTools,
    profile: ptProfile,
    autoarrange: ptAutoArrange,
  },
} as const;

export const LOCALE_STORAGE_KEY = "bandsync.locale";

/** Maps any BCP-47 tag to one of the supported locales (English is the fallback). */
export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const lower = tag.toLowerCase();
  if (lower.startsWith("pt")) return "pt-BR";
  if (lower.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

export const missingKeys: string[] = [];

export function initI18n(initialLocale?: Locale) {
  if (i18next.isInitialized) return i18next;
  i18next
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      supportedLngs: [...LOCALES],
      fallbackLng: DEFAULT_LOCALE,
      lng: initialLocale,
      ns: [...NAMESPACES],
      defaultNS: "common",
      interpolation: { escapeValue: false },
      returnNull: false,
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: LOCALE_STORAGE_KEY,
        caches: ["localStorage"],
        convertDetectedLanguage: (lng: string) => resolveLocale(lng),
      },
      saveMissing: import.meta.env.DEV || import.meta.env.MODE === "test",
      missingKeyHandler: (_lngs, ns, key) => {
        const id = `${ns}:${key}`;
        if (!missingKeys.includes(id)) {
          missingKeys.push(id);
          if (import.meta.env.DEV) console.warn(`[i18n] missing key ${id}`);
        }
      },
    });
  i18next.on("languageChanged", (lng) => {
    document.documentElement.lang = lng;
  });
  return i18next;
}

export async function setLocale(locale: Locale) {
  await i18next.changeLanguage(locale);
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // storage may be unavailable (private mode); the account preference still applies on next load
  }
}

export default i18next;

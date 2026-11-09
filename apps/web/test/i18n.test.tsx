import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";
import {
  initI18n,
  missingKeys,
  NAMESPACES,
  resolveLocale,
  resources,
  setLocale,
} from "../src/lib/i18n";

function flatten(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("locale resources", () => {
  it("has exactly the same keys in pt-BR and en for every namespace", () => {
    for (const ns of NAMESPACES) {
      const en = flatten(resources.en[ns]).sort();
      const pt = flatten(resources["pt-BR"][ns]).sort();
      const onlyEn = en.filter((k) => !pt.includes(k));
      const onlyPt = pt.filter((k) => !en.includes(k));
      expect({ ns, onlyEn, onlyPt }).toEqual({ ns, onlyEn: [], onlyPt: [] });
    }
  });

  it("has no empty strings", () => {
    for (const lng of ["en", "pt-BR"] as const) {
      for (const ns of NAMESPACES) {
        const walk = (o: unknown, path: string) => {
          if (typeof o === "string") expect(o.trim(), `${lng}:${ns}:${path}`).not.toBe("");
          else if (o && typeof o === "object")
            for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
        };
        walk(resources[lng][ns], "");
      }
    }
  });

  it("keeps interpolation placeholders consistent between languages", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const ns of NAMESPACES) {
      const en = resources.en[ns] as Record<string, unknown>;
      const pt = resources["pt-BR"][ns] as Record<string, unknown>;
      const walk = (a: unknown, b: unknown, path: string) => {
        if (typeof a === "string" && typeof b === "string")
          expect(placeholders(b), `${ns}:${path}`).toEqual(placeholders(a));
        else if (a && b && typeof a === "object" && typeof b === "object") {
          for (const k of Object.keys(a))
            walk(
              (a as Record<string, unknown>)[k],
              (b as Record<string, unknown>)[k],
              `${path}.${k}`,
            );
        }
      };
      walk(en, pt, "");
    }
  });

  it("maps device languages to supported locales with English fallback", () => {
    expect(resolveLocale("pt-BR")).toBe("pt-BR");
    expect(resolveLocale("pt-PT")).toBe("pt-BR");
    expect(resolveLocale("en-GB")).toBe("en");
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
  });
});

function Probe() {
  const { t } = useTranslation(["rehearsal", "common"]);
  return (
    <div>
      <h1>{t("rehearsal:lobby.title")}</h1>
      <p data-testid="plural">{t("common:count.members", { count: 3 })}</p>
      <p data-testid="missing">{t("common:does.not.exist")}</p>
    </div>
  );
}

describe("runtime translation", () => {
  beforeAll(async () => {
    initI18n("en");
    await i18next.changeLanguage("en");
  });

  it("renders in English, switches to Portuguese without remounting, and records missing keys", async () => {
    render(
      <I18nextProvider i18n={i18next}>
        <Probe />
      </I18nextProvider>,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Live rehearsal");
    expect(screen.getByTestId("plural")).toHaveTextContent("3 members");
    await setLocale("pt-BR");
    expect(screen.getByRole("heading")).toHaveTextContent("Ensaio ao vivo");
    expect(screen.getByTestId("plural")).toHaveTextContent("3 integrantes");
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(localStorage.getItem("bandsync.locale")).toBe("pt-BR");
    // Missing keys fall back to the key itself and are recorded for CI.
    expect(screen.getByTestId("missing")).toHaveTextContent("does.not.exist");
    expect(missingKeys.some((k) => k.endsWith("does.not.exist"))).toBe(true);
  });

  it("formats dates and numbers by locale", async () => {
    const { formatDate, formatNumber } = await import("../src/lib/format");
    const d = "2026-03-05T18:30:00Z";
    expect(formatDate(d, "pt-BR", "UTC")).toMatch(/5 de mar/);
    expect(formatDate(d, "en", "UTC")).toMatch(/Mar 5, 2026/);
    expect(formatNumber(1234.5, "pt-BR")).toBe("1.234,5");
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
  });
});

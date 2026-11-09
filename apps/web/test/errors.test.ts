import { API_ERROR_CODES } from "@bandsync/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api";
import { errorText, errorTextFor } from "../src/lib/errors";
import { initI18n, resources, setLocale } from "../src/lib/i18n";

beforeAll(() => {
  initI18n("pt-BR");
});

describe("error messages", () => {
  it("has a real sentence for every error code the server can send, in both languages", () => {
    for (const lng of ["pt-BR", "en"] as const) {
      const errors = (resources[lng].common as { errors: Record<string, string> }).errors;
      for (const code of [...API_ERROR_CODES, "network"]) {
        expect(errors[code], `${lng}: ${code}`).toBeTruthy();
        expect(errors[code], `${lng}: ${code}`).not.toMatch(/errors\.|_/);
      }
    }
  });

  it("explains a confirmation request in words, never as an internal key", async () => {
    await setLocale("pt-BR");
    const err = new ApiError(
      "confirmation_required",
      409,
      "replacing the reference needs confirmation",
    );
    expect(errorText(err)).toBe("Esta alteração precisa ser confirmada.");
    await setLocale("en");
    expect(errorText(err)).toBe("This change needs to be confirmed.");
  });

  it("falls back to the generic message for a code this page does not know yet", async () => {
    // e.g. a code added on the server after this copy of the interface was loaded.
    await setLocale("pt-BR");
    const unknown = new ApiError("brand_new_code" as never, 409);
    expect(errorText(unknown)).toBe("Erro inesperado no servidor. Tente novamente.");
    expect(errorTextFor("another_unknown")).not.toContain("errors.");
    await setLocale("en");
    expect(errorText(unknown)).toBe("Unexpected server error. Please try again.");
    expect(errorText(new Error("boom"))).toBe("Unexpected server error. Please try again.");
  });
});

import { describe, expect, it, vi } from "vitest";
import { detectLanguage, initialLanguage, readStoredLanguage, translate, validateResourceCompleteness, writeStoredLanguage } from "./core";

describe("i18n core", () => {
  it("selects supported browser languages and falls back to Italian", () => {
    expect(detectLanguage("it-IT")).toBe("it");
    expect(detectLanguage("en-GB")).toBe("en");
    expect(detectLanguage("fr-FR")).toBe("it");
  });

  it("uses a stored language only when supported", () => {
    expect(readStoredLanguage({ getItem: () => "it" })).toBe("it");
    expect(readStoredLanguage({ getItem: () => "fr" })).toBeNull();
  });

  it("starts in Italian unless the user already selected a language", () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
    };

    expect(initialLanguage(storage)).toBe("it");
    writeStoredLanguage("en", storage);
    expect(initialLanguage(storage)).toBe("en");
  });

  it("uses Italian as the default fallback language", () => {
    expect(translate("it", "common.appName")).toBe("LMU Race Control");
  });

  it("supports pluralized and interpolated strings", () => {
    expect(translate("en", "common.laps", { count: 1 })).toBe("1 lap");
    expect(translate("en", "common.laps", { count: 3 })).toBe("3 laps");
    expect(translate("it", "liveDashboard.lapWithTrigger", { lap: 12, trigger: "Carburante" })).toBe("Giro 12 · Carburante");
  });

  it("reports no missing translation keys", () => {
    expect(validateResourceCompleteness()).toEqual([]);
  });

  it("exposes missing keys clearly in development", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(translate("en", "missing.example")).toContain("missing.example");
    spy.mockRestore();
  });
});

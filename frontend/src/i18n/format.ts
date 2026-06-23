import { defaultLanguage, type Language } from "./resources";

export function localeFor(language: Language) {
  return language === "it" ? "it-IT" : "en-US";
}

export function formatLocaleNumber(value: number, language: Language = defaultLanguage, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(localeFor(language), options).format(value);
}

export function formatValueWithUnit(value: number | null | undefined, language: Language, options: Intl.NumberFormatOptions, unit = "") {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "--";
  const formatted = formatLocaleNumber(value, language, options);
  return unit ? `${formatted} ${unit}` : formatted;
}

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { detectLanguage, initialLanguage, setRuntimeLanguage, translate, writeStoredLanguage, type TranslationValues } from "./core";
import { installLegacyTextLocalizer } from "./legacyText";
import { defaultLanguage, languages, type Language } from "./resources";

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, values?: TranslationValues) => string;
  languages: typeof languages;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDateTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  formatRelativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [languageState, setLanguageState] = useState<Language>(() => initialLanguage());
  const language = languageState || detectLanguage() || defaultLanguage;

  useEffect(() => {
    setRuntimeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => installLegacyTextLocalizer(language), [language]);

  const value = useMemo<I18nContextValue>(() => {
    const locale = language === "it" ? "it-IT" : "en-US";
    return {
      language,
      setLanguage(nextLanguage) {
        writeStoredLanguage(nextLanguage);
        setRuntimeLanguage(nextLanguage);
        document.documentElement.lang = nextLanguage;
        setLanguageState(nextLanguage);
      },
      t: (key, values) => translate(language, key, values),
      languages,
      formatNumber: (number, options) => new Intl.NumberFormat(locale, options).format(number),
      formatDateTime: (date, options) => new Intl.DateTimeFormat(locale, options).format(new Date(date)),
      formatRelativeTime: (amount, unit) => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(amount, unit),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

export function useT() {
  return useI18n().t;
}

import { defaultLanguage, languages, resources, storageKey, type Language, type TranslationTree } from "./resources";

export type TranslationValues = Record<string, string | number | boolean | null | undefined>;
let runtimeLanguage: Language = defaultLanguage;

export function isLanguage(value: string | null | undefined): value is Language {
  return Boolean(value && value in languages);
}

export function detectLanguage(locale = typeof navigator !== "undefined" ? navigator.language : defaultLanguage): Language {
  const base = locale.toLowerCase().split("-")[0];
  return isLanguage(base) ? base : defaultLanguage;
}

export function readStoredLanguage(storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" ? window.localStorage : null): Language | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(storageKey);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredLanguage(language: Language, storage: Pick<Storage, "setItem"> | null = typeof window !== "undefined" ? window.localStorage : null) {
  if (!storage) return;
  try {
    storage.setItem(storageKey, language);
  } catch {
    // Storage can be blocked in embedded or private contexts; runtime language still changes.
  }
}

export function initialLanguage(storage: Pick<Storage, "getItem"> | null = typeof window !== "undefined" ? window.localStorage : null) {
  runtimeLanguage = readStoredLanguage(storage) || defaultLanguage;
  return runtimeLanguage;
}

export function setRuntimeLanguage(language: Language) {
  runtimeLanguage = language;
}

export function getRuntimeLanguage() {
  return runtimeLanguage;
}

export function flattenKeys(tree: TranslationTree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : flattenKeys(value, path);
  });
}

function lookup(tree: TranslationTree, key: string): string | undefined {
  let cursor: string | TranslationTree | undefined = tree;
  for (const part of key.split(".")) {
    if (!cursor || typeof cursor === "string") return undefined;
    cursor = cursor[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function pluralKey(key: string, values?: TranslationValues) {
  const count = values?.count;
  if (typeof count !== "number") return key;
  return count === 1 ? `${key}_one` : `${key}_other`;
}

export function translate(language: Language, key: string, values?: TranslationValues): string {
  const keyWithPlural = pluralKey(key, values);
  const translated = lookup(resources[language], keyWithPlural) ?? lookup(resources[language], key);
  const fallback = lookup(resources[defaultLanguage], keyWithPlural) ?? lookup(resources[defaultLanguage], key);
  const template = translated ?? fallback;

  if (!template) {
    console.warn(`[i18n] Missing translation key: ${key}`);
    return `⟦${key}⟧`;
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
    const value = values?.[token];
    return value == null ? "" : String(value);
  });
}

export function validateResourceCompleteness() {
  const reference = new Set(flattenKeys(resources[defaultLanguage]));
  const problems: string[] = [];
  (Object.keys(resources) as Language[]).forEach((language) => {
    const keys = flattenKeys(resources[language]);
    const seen = new Set<string>();
    keys.forEach((key) => {
      if (seen.has(key)) problems.push(`${language}: duplicate key ${key}`);
      seen.add(key);
    });
    reference.forEach((key) => {
      if (!seen.has(key)) problems.push(`${language}: missing key ${key}`);
    });
  });
  return problems;
}

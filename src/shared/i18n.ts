/** Texts from locales/*.ftl for the Mini App and the bot. Fluent picks plural forms per language. */
import { FluentBundle, FluentResource, type FluentVariable } from "@fluent/bundle";
import { LANGUAGES, type Language } from "./api.ts";

export type TextArgs = Readonly<Record<string, FluentVariable>>;
export type Translate = (key: string, args?: TextArgs) => string;

/** Message ids in one .ftl source. */
export const keysOf = (source: string): string[] =>
  new FluentResource(source).body.map((entry) => entry.id);

/** Fails at startup on a broken catalog, and on a missing key when it is used: both are bugs. */
export function createTranslations(sources: Record<Language, string>) {
  const bundles = new Map(
    LANGUAGES.map((language) => {
      // No invisible isolation marks around values: they break copying numbers
      const bundle = new FluentBundle(language, { useIsolating: false });
      const errors = bundle.addResource(new FluentResource(sources[language]));
      if (errors.length)
        throw new Error(`${language}.ftl: ${errors.map((e) => e.message).join("; ")}`);
      return [language, bundle] as const;
    }),
  );

  return (language: Language): Translate =>
    (key, args) => {
      const bundle = bundles.get(language)!;
      const message = bundle.getMessage(key);
      if (!message?.value) throw new Error(`No text "${key}" in ${language}.ftl`);
      const errors: Error[] = [];
      const text = bundle.formatPattern(message.value, args, errors);
      if (errors.length) throw new Error(`${language}.ftl, ${key}: ${errors[0]!.message}`);
      return text;
    };
}

/** Telegram language code → game language; Russian for ru-*, English otherwise. */
export const languageFrom = (code: string | null | undefined): Language =>
  code?.toLowerCase().startsWith("ru") ? "ru" : "en";

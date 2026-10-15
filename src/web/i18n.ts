import { createTranslations, type Translate } from "../shared/i18n.ts";
// Vite inlines the catalogs into the bundle: the page has no files to read at runtime
import en from "../locales/en.ftl?raw";
import ru from "../locales/ru.ftl?raw";

export const translations = createTranslations({ ru, en });
export type { Translate };

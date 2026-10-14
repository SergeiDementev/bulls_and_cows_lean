/** The part of window.Telegram.WebApp (telegram-web-app.js, see index.html) the Mini App uses. */

export interface TelegramWebApp {
  /** Signed player data; empty when the page is opened outside Telegram. */
  readonly initData: string;
  readonly initDataUnsafe: { readonly user?: { readonly language_code?: string } };
  readonly colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  onEvent(event: "themeChanged", handler: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
    /** Set by the Vite dev server only (vite.config.ts); never present in a build. */
    __DEV_INIT_DATA__?: string;
  }
}

export const telegram = (): TelegramWebApp | null => window.Telegram?.WebApp ?? null;

/** Light or dark tiles follow the Telegram theme; outside Telegram the CSS follows the system. */
export function followTheme(tg: TelegramWebApp, root: HTMLElement): void {
  const apply = () => {
    root.dataset.theme = tg.colorScheme;
  };
  apply();
  tg.onEvent("themeChanged", apply);
}

export function initDataOf(tg: TelegramWebApp | null): string {
  const initData = tg?.initData ?? "";
  // import.meta.env.DEV is false in a build, so this branch is removed from it entirely
  if (!initData && import.meta.env.DEV) return window.__DEV_INIT_DATA__ ?? "";
  return initData;
}

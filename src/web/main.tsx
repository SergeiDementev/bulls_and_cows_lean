import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { languageFrom } from "../shared/i18n.ts";
import { createApi } from "./api.ts";
import { App } from "./App.tsx";
import { MessageScreen } from "./components.tsx";
import { translations } from "./i18n.ts";
import { createReporter } from "./report.ts";
import "./styles.css";
import { followTheme, initDataOf, telegram } from "./telegram.ts";

const tg = telegram();
const initData = initDataOf(tg);
const language = languageFrom(tg?.initDataUnsafe.user?.language_code ?? navigator.language);
const container = document.getElementById("root")!;
document.documentElement.lang = language;

if (!initData) {
  // Opened outside Telegram: without signed data the server cannot tell who the player is
  const t = translations(language);
  const bot = import.meta.env.VITE_BOT_USERNAME;
  createRoot(container).render(
    <MessageScreen
      text={t("open-in-telegram")}
      label={t("button-open-bot")}
      {...(bot && { href: `https://t.me/${bot}` })}
    />,
  );
} else {
  tg?.ready();
  tg?.expand();
  if (tg?.initData) followTheme(tg, document.documentElement);

  const api = createApi(initData);
  const reporter = createReporter(api.reportError);
  // Errors outside React too: event handlers, promises nobody awaited
  window.addEventListener("error", (e) => reporter.report(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reporter.report(e.reason));

  createRoot(container, { onUncaughtError: reporter.report }).render(
    <StrictMode>
      <App
        api={api}
        initialLanguage={language}
        reporter={reporter}
        onClose={() => tg?.close()}
        onReload={() => window.location.reload()}
      />
    </StrictMode>,
  );
}

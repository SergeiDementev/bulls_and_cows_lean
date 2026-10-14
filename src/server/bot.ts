/** The bot is only a door into the Mini App: /start answers with the rules and a Play button. */
import { readFileSync } from "node:fs";
import { createTranslations, languageFrom, type Translate } from "../shared/i18n.ts";
import type { Language } from "../shared/api.ts";
import type { Db } from "./db.ts";

const read = (language: Language) =>
  readFileSync(new URL(`../../locales/${language}.ftl`, import.meta.url), "utf8");
export const serverTranslations = createTranslations({ ru: read("ru"), en: read("en") });

/** The part of a Telegram Update the bot reads. */
export interface Update {
  message?: {
    chat: { id: number };
    from?: { id: number; language_code?: string };
    text?: string;
  };
}

export interface BotDeps {
  db: Db;
  webAppUrl: string;
  gameLength: number;
}

const rulesText = (t: Translate, length: number): string =>
  [
    t("header-title"),
    t("header-rules", { length }),
    `${t("header-bull")}\n${t("header-cow")}`,
  ].join("\n\n");

/**
 * Returns the reply as a Bot API method call: Telegram executes a method sent back in the
 * webhook response, so the server never calls Telegram itself. null — nothing to answer.
 */
export async function handleUpdate(update: Update, deps: BotDeps): Promise<object | null> {
  const message = update.message;
  if (!message?.text?.startsWith("/start") || !message.from) return null;

  // A known player gets the language they chose in the Mini App
  const player = await deps.db
    .selectFrom("players")
    .select("language")
    .where("telegram_id", "=", String(message.from.id))
    .executeTakeFirst();
  const t = serverTranslations(player?.language ?? languageFrom(message.from.language_code));

  return {
    method: "sendMessage",
    chat_id: message.chat.id,
    text: rulesText(t, deps.gameLength),
    reply_markup: {
      inline_keyboard: [[{ text: t("bot-button-play"), web_app: { url: deps.webAppUrl } }]],
    },
  };
}

export interface SetupConfig {
  BOT_TOKEN: string;
  WEBAPP_URL: string;
  WEBHOOK_SECRET: string;
  GAME_LENGTH: number;
}

/** One-time bot setup on the server: webhook, description in both languages, no command list. */
export async function setupBot(config: SetupConfig, fetchFn: typeof fetch = fetch) {
  const call = async (method: string, params: object) => {
    const response = await fetchFn(`https://api.telegram.org/bot${config.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await response.json()) as { ok: boolean; description?: string };
    // Report the method name only: the URL contains the token
    return {
      method,
      ...("language_code" in params && { language: params.language_code }),
      ...body,
    };
  };
  const description = (language: Language) =>
    serverTranslations(language)("bot-description", { length: config.GAME_LENGTH });

  return [
    await call("setWebhook", {
      url: `${config.WEBAPP_URL}/telegram/webhook`,
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
    // No language code: the default for everyone who is not Russian-speaking
    await call("setMyDescription", { description: description("en") }),
    await call("setMyDescription", { description: description("ru"), language_code: "ru" }),
    // The Mini App opens from the menu button; the old /start command list is not needed
    await call("deleteMyCommands", {}),
    await call("deleteMyCommands", { language_code: "ru" }),
    await call("deleteMyCommands", { language_code: "en" }),
  ];
}

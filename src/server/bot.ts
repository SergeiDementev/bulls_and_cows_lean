/**
 * The bot is only a door into the Mini App: /start answers with the rules and a Play button.
 * The greeting is remembered per chat, so a language switch in the Mini App can rewrite it.
 */
import { readFileSync } from "node:fs";
import type { Language } from "../shared/api.ts";
import { createTranslations, languageFrom, type Translate } from "../shared/i18n.ts";
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

/** Calls a Bot API method; throws with Telegram's own description when it refuses. */
export type Telegram = (method: string, params: object) => Promise<unknown>;

export function createTelegram(botToken: string, fetchFn: typeof fetch = fetch): Telegram {
  return async (method, params) => {
    const response = await fetchFn(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      // A slow Telegram must not hold up a language switch in the Mini App
      signal: AbortSignal.timeout(5000),
    });
    const body = (await response.json()) as { ok: boolean; result?: unknown; description?: string };
    // The method name only: the URL contains the token
    if (!body.ok) throw new Error(`${method}: ${body.description ?? response.status}`);
    return body.result;
  };
}

export interface BotDeps {
  db: Db;
  telegram: Telegram;
  webAppUrl: string;
  gameLength: number;
  log: { warn(details: object, message: string): void };
}

const rulesText = (t: Translate, length: number): string =>
  [
    t("header-title"),
    t("header-rules", { length }),
    `${t("header-bull")}\n${t("header-cow")}`,
  ].join("\n\n");

function greeting(t: Translate, deps: BotDeps) {
  return {
    text: rulesText(t, deps.gameLength),
    reply_markup: {
      inline_keyboard: [[{ text: t("bot-button-play"), web_app: { url: deps.webAppUrl } }]],
    },
  };
}

/** The menu button next to the input field can carry its own label in each chat. */
const menuButton = (chatId: number | string, t: Translate, deps: BotDeps) =>
  deps.telegram("setChatMenuButton", {
    chat_id: chatId,
    menu_button: { type: "web_app", text: t("bot-button-play"), web_app: { url: deps.webAppUrl } },
  });

/**
 * Telegram's refusals are logged, never thrown: they must not fail the player's action.
 * Returns whether the call went through.
 */
async function quietly(deps: BotDeps, action: string, call: () => Promise<unknown>) {
  try {
    await call();
    return true;
  } catch (error) {
    deps.log.warn({ err: error, action }, "telegram call failed");
    return false;
  }
}

/** /start: a new greeting in the player's language; the previous one is removed. */
export async function handleUpdate(update: Update, deps: BotDeps): Promise<void> {
  const message = update.message;
  if (!message?.text?.startsWith("/start") || !message.from) return;
  const telegramId = String(message.from.id);
  const chatId = message.chat.id;

  // A known player gets the language they chose in the Mini App
  const player = await deps.db
    .selectFrom("players")
    .select("language")
    .where("telegram_id", "=", telegramId)
    .executeTakeFirst();
  const t = serverTranslations(player?.language ?? languageFrom(message.from.language_code));
  const previous = await deps.db
    .selectFrom("bot_greetings")
    .select(["chat_id", "message_id"])
    .where("telegram_id", "=", telegramId)
    .executeTakeFirst();

  const sent = await quietly(deps, "send greeting", async () => {
    const posted = (await deps.telegram("sendMessage", {
      chat_id: chatId,
      ...greeting(t, deps),
    })) as {
      message_id: number;
    };
    await deps.db
      .insertInto("bot_greetings")
      .values({ telegram_id: message.from!.id, chat_id: chatId, message_id: posted.message_id })
      .onConflict((oc) =>
        oc
          .column("telegram_id")
          .doUpdateSet({ chat_id: chatId, message_id: posted.message_id, sent_at: new Date() }),
      )
      .execute();
  });
  await quietly(deps, "menu button", () => menuButton(chatId, t, deps));
  // Only once the new greeting is there. Telegram deletes only messages younger than 48 hours;
  // an older greeting simply stays
  if (sent && previous) {
    await quietly(deps, "delete previous greeting", () =>
      deps.telegram("deleteMessage", {
        chat_id: previous.chat_id,
        message_id: previous.message_id,
      }),
    );
  }
}

/** After a language switch in the Mini App: the greeting and the menu button follow it. */
export async function onLanguageChanged(telegramId: number, language: Language, deps: BotDeps) {
  const saved = await deps.db
    .selectFrom("bot_greetings")
    .select(["chat_id", "message_id"])
    .where("telegram_id", "=", String(telegramId))
    .executeTakeFirst();
  if (!saved) return;
  const t = serverTranslations(language);
  await quietly(deps, "rewrite greeting", () =>
    deps.telegram("editMessageText", {
      chat_id: saved.chat_id,
      message_id: saved.message_id,
      ...greeting(t, deps),
    }),
  );
  await quietly(deps, "menu button", () => menuButton(saved.chat_id, t, deps));
}

export interface SetupConfig {
  BOT_TOKEN: string;
  WEBAPP_URL: string;
  WEBHOOK_SECRET: string;
  GAME_LENGTH: number;
}

/** One-time bot setup on the server: webhook, one description for all, no command list. */
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

  return [
    await call("setWebhook", {
      url: `${config.WEBAPP_URL}/telegram/webhook`,
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
    // No language code: the default for everyone who is not Russian-speaking
    // One description for everyone: Telegram shows it by the language of its app, so it could
    // never follow the language chosen in the Mini App. The Russian one set before is removed
    await call("setMyDescription", { description: serverTranslations("en")("bot-description") }),
    await call("setMyDescription", { description: "", language_code: "ru" }),
    // The Mini App opens from the menu button; the old /start command list is not needed
    await call("deleteMyCommands", {}),
    await call("deleteMyCommands", { language_code: "ru" }),
    await call("deleteMyCommands", { language_code: "en" }),
  ];
}

/**
 * Prints signed initData for a made-up player, to call the local server by hand:
 *   pnpm dev:init-data [telegramId] [username] [languageCode]
 * Signed with BOT_TOKEN from .env — locally any string works.
 */
import { signInitData } from "../src/server/init-data.ts";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is missing in .env");

const [id = "1001", username = "dev_player", languageCode = "ru"] = process.argv.slice(2);
console.log(
  signInitData(
    { id: Number(id), username, language_code: languageCode },
    token,
    Math.floor(Date.now() / 1000),
  ),
);

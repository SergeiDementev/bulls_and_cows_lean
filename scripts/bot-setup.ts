/**
 * One-time bot setup, run on the server inside the app container (docs/deploy.md):
 *   docker compose ... exec app node scripts/bot-setup.ts
 * Prints each Bot API method and whether it succeeded; never the token.
 */
import { setupBot } from "../src/server/bot.ts";
import { loadConfig } from "../src/server/config.ts";

const config = loadConfig(process.env);
if (!config.WEBAPP_URL || !config.WEBHOOK_SECRET) {
  throw new Error("WEBAPP_URL and WEBHOOK_SECRET are required for the bot setup");
}
const results = await setupBot({
  ...config,
  WEBAPP_URL: config.WEBAPP_URL,
  WEBHOOK_SECRET: config.WEBHOOK_SECRET,
});
for (const r of results) console.log(JSON.stringify(r));
if (results.some((r) => !r.ok)) process.exit(1);

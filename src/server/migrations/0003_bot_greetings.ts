import { sql, type Kysely } from "kysely";

/**
 * The bot's greeting in each chat, so a language switch in the Mini App can rewrite it and a new
 * /start can remove the previous one. Keyed by the Telegram user: a player may not exist yet.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("bot_greetings")
    .addColumn("telegram_id", "bigint", (c) => c.primaryKey())
    .addColumn("chat_id", "bigint", (c) => c.notNull())
    .addColumn("message_id", "integer", (c) => c.notNull())
    .addColumn("sent_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(): Promise<void> {
  throw new Error("Migrations only go forward: write a new migration instead");
}

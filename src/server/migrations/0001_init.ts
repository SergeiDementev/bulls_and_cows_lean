import { sql, type Kysely } from "kysely";

// Migrations get an untyped Kysely: they describe the schema as it was then, not as it is now
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("players")
    .addColumn("id", "serial", (c) => c.primaryKey())
    .addColumn("telegram_id", "bigint", (c) => c.notNull().unique())
    .addColumn("username", "text")
    .addColumn("language", "text", (c) => c.notNull().check(sql`language in ('ru', 'en')`))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("rating_average", "double precision", (c) => c.check(sql`rating_average >= 1`))
    .addColumn("rating_wins", "smallint", (c) => c.check(sql`rating_wins >= 0`))
    .addColumn("rating_games", "smallint", (c) => c.check(sql`rating_games >= 1`))
    .addCheckConstraint(
      "players_rating_all_or_none",
      sql`(rating_average is null) = (rating_wins is null)
      and (rating_wins is null) = (rating_games is null)`,
    )
    .execute();

  await db.schema
    .createIndex("players_rating_order")
    .on("players")
    .columns(["rating_average", "rating_wins desc", "id"])
    .where(sql<boolean>`rating_average is not null`)
    .execute();

  await db.schema
    .createTable("games")
    .addColumn("id", "serial", (c) => c.primaryKey())
    .addColumn("player_id", "integer", (c) => c.notNull().references("players.id"))
    .addColumn("length", "smallint", (c) => c.notNull().check(sql`length between 1 and 10`))
    .addColumn("secret", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) =>
      c.notNull().check(sql`status in ('active', 'won', 'abandoned')`),
    )
    .addColumn("attempt_count", "smallint", (c) =>
      c
        .notNull()
        .defaultTo(0)
        .check(sql`attempt_count >= 0`),
    )
    .addColumn("started_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("finished_at", "timestamptz")
    // "(.).*\1": a character, anything, then the same character again — a repeated digit
    .addCheckConstraint(
      "games_secret_valid",
      sql`secret ~ '^[0-9]+$' and char_length(secret) = length and secret !~ '(.).*\\1'`,
    )
    .addCheckConstraint(
      "games_finished_iff_not_active",
      sql`(finished_at is null) = (status = 'active')`,
    )
    .execute();

  // Two simultaneous "new game" requests both pass the check in code; only one row survives here
  await db.schema
    .createIndex("games_one_active_per_player")
    .on("games")
    .column("player_id")
    .unique()
    .where(sql<boolean>`status = 'active'`)
    .execute();

  await db.schema
    .createIndex("games_player_history")
    .on("games")
    .columns(["player_id", "finished_at"])
    .execute();

  await db.schema
    .createTable("guesses")
    .addColumn("game_id", "integer", (c) => c.notNull().references("games.id"))
    .addColumn("attempt_no", "smallint", (c) => c.notNull().check(sql`attempt_no >= 1`))
    .addColumn("value", "text", (c) => c.notNull().check(sql`value ~ '^[0-9]+$'`))
    .addColumn("bulls", "smallint", (c) => c.notNull().check(sql`bulls >= 0`))
    .addColumn("cows", "smallint", (c) => c.notNull().check(sql`cows >= 0`))
    .addColumn("remaining", "integer", (c) => c.notNull().check(sql`remaining >= 1`))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("guesses_pk", ["game_id", "attempt_no"])
    .execute();
}

export async function down(): Promise<void> {
  throw new Error("Migrations only go forward: write a new migration instead");
}

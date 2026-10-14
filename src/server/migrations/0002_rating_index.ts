import type { Kysely } from "kysely";

/**
 * The rating index from 0001 covered only rows with a summary (a partial index). The rating
 * query filters by rating_wins, which does not tell PostgreSQL that rating_average is set, so
 * it never used the index and sorted every player instead (found by the load test). A full
 * index on the same columns serves both the top 10 and "my place".
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("players_rating_order").execute();
  await db.schema
    .createIndex("players_rating_order")
    .on("players")
    .columns(["rating_average", "rating_wins desc", "id"])
    .execute();
}

export async function down(): Promise<void> {
  throw new Error("Migrations only go forward: write a new migration instead");
}

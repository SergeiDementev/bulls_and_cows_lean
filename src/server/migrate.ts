import { Migrator, type Migration } from "kysely/migration";
import type { Db } from "./db.ts";
import * as init from "./migrations/0001_init.ts";
import * as ratingIndex from "./migrations/0002_rating_index.ts";

// Listed explicitly rather than read from disk: nothing to resolve at runtime in the container
const migrations: Record<string, Migration> = {
  "0001_init": init,
  "0002_rating_index": ratingIndex,
};

/** Applies pending migrations. Kysely holds a database lock, so two processes cannot race. */
export async function migrateToLatest(db: Db): Promise<string[]> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
  const { error, results = [] } = await migrator.migrateToLatest();
  if (error) throw error;
  return results.map((r) => r.migrationName);
}

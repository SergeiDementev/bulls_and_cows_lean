import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { migrateToLatest } from "./migrate.ts";

const config = loadConfig(process.env);
const db = createDb(config.DATABASE_URL, config.DB_POOL_SIZE);
const applied = await migrateToLatest(db);

const app = buildApp({ db, config });
app.log.info({ applied }, "migrations applied");
await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  });
}

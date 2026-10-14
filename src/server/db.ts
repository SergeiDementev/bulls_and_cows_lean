import { AsyncLocalStorage } from "node:async_hooks";
import { Kysely, PostgresDialect, type ColumnType, type Generated } from "kysely";
import pg from "pg";
import type { GameStatus, Language } from "../shared/api.ts";

// Hand-written to match src/server/migrations; a mismatch shows up in the tests on a real database
export interface Database {
  players: {
    id: Generated<number>;
    // int8 comes back from pg as a string; Telegram ids fit in a JS number
    telegram_id: ColumnType<string, number, never>;
    username: string | null;
    language: Language;
    created_at: Generated<Date>;
    rating_average: number | null;
    rating_wins: number | null;
    rating_games: number | null;
  };
  games: {
    id: Generated<number>;
    player_id: number;
    length: number;
    secret: string;
    status: GameStatus;
    attempt_count: Generated<number>;
    started_at: Generated<Date>;
    finished_at: Date | null;
  };
  guesses: {
    game_id: number;
    attempt_no: number;
    value: string;
    bulls: number;
    cows: number;
    remaining: number;
    created_at: Generated<Date>;
  };
}

export type Db = Kysely<Database>;

export interface QueryStats {
  queries: number;
  ms: number;
}

/** Collects database time for the HTTP request currently being handled. */
export const queryStats = new AsyncLocalStorage<QueryStats>();

export function createDb(connectionString: string, poolSize: number): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: poolSize }) }),
    log(event) {
      const stats = queryStats.getStore();
      if (stats) {
        stats.queries++;
        stats.ms += event.queryDurationMillis;
      }
    },
  });
}

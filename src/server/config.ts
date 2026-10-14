import { z } from "zod";

const int = (fallback: number, min = 0) => z.coerce.number().int().min(min).default(fallback);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  HOST: z.string().default("127.0.0.1"),
  PORT: int(3000, 1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DB_POOL_SIZE: int(10, 1),
  GAME_LENGTH: z.coerce.number().int().min(1).max(6).default(4),
  INIT_DATA_MAX_AGE_SECONDS: int(24 * 60 * 60, 1),
  RATE_LIMIT_PER_PLAYER: int(120, 1),
  RATE_LIMIT_PER_IP_UNAUTHORIZED: int(30, 1),
  SLOW_REQUEST_MS: int(200),
});

export type Config = z.infer<typeof schema>;

/** Fails at startup with every problem listed, instead of an hour later on the first request. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

/** Shared setup for the server tests on a real database. */
import { sql } from "kysely";
import { afterAll, beforeEach, expect, inject } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig, type Config } from "./config.ts";
import { createDb, type Db } from "./db.ts";
import { signInitData } from "./init-data.ts";

export const BOT_TOKEN = "test-bot-token";

export interface TestUser {
  id: number;
  username?: string;
  language_code?: string;
}

export interface Response {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- assertions read it freely
  headers: Record<string, unknown>;
}

/** Walks a response and fails if any active game in it carries its secret. */
export function expectNoActiveSecret(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(expectNoActiveSecret);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("secret" in record && record.status === "active") expect(record.secret).toBeNull();
    Object.values(record).forEach(expectNoActiveSecret);
  }
}

/**
 * One database per test file, emptied before every test. `ctx.now` is the server clock;
 * tests move it to expire initData or reset rate-limit windows.
 */
export function useServer(overrides: Partial<Record<keyof Config, string>> = {}) {
  const db: Db = createDb(inject("testDatabaseUrl"), 5);
  const ctx = {
    db,
    now: Date.now(),
    logs: [] as Record<string, unknown>[],
    app: undefined as unknown as ReturnType<typeof buildApp>,
    config: undefined as unknown as Config,
    /** A fake Telegram: every Bot API call, in order; methods in `failing` are refused. */
    telegram: {
      calls: [] as { method: string; params: Record<string, unknown> }[],
      failing: new Set<string>(),
      /** Methods that never answer: a Telegram that hangs. */
      hanging: new Set<string>(),
    },
  };
  let messageId = 100;
  const telegramFetch: typeof fetch = async (url, init) => {
    const method = String(url).split("/").at(-1)!;
    ctx.telegram.calls.push({ method, params: JSON.parse(String(init?.body)) });
    if (ctx.telegram.hanging.has(method)) return new Promise<never>(() => undefined);
    const body = ctx.telegram.failing.has(method)
      ? { ok: false, description: "Bad Request: refused by the test" }
      : { ok: true, result: method === "sendMessage" ? { message_id: ++messageId } : true };
    return new Response(JSON.stringify(body));
  };

  beforeEach(async () => {
    await ctx.app?.close();
    await sql`truncate guesses, games, players, bot_greetings restart identity cascade`.execute(db);
    ctx.now = Date.now();
    ctx.logs = [];
    ctx.telegram = { calls: [], failing: new Set(), hanging: new Set() };
    messageId = 100;
    ctx.config = loadConfig({
      DATABASE_URL: inject("testDatabaseUrl"),
      BOT_TOKEN,
      LOG_LEVEL: "info",
      ...overrides,
    });
    ctx.app = buildApp({
      db,
      config: ctx.config,
      now: () => ctx.now,
      logStream: { write: (line) => void ctx.logs.push(JSON.parse(line)) },
      telegramFetch,
    });
  });

  afterAll(async () => {
    await ctx.app?.close();
    await db.destroy();
  });

  return ctx;
}

export const authHeader = (user: TestUser, authDateSeconds: number): string =>
  `tma ${signInitData(user, BOT_TOKEN, authDateSeconds)}`;

export async function call(
  ctx: ReturnType<typeof useServer>,
  method: "GET" | "POST" | "PATCH",
  url: string,
  options: { user?: TestUser; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.user) headers.authorization = authHeader(options.user, Math.floor(ctx.now / 1000));
  const res = await ctx.app.inject({
    method,
    url,
    headers,
    ...(options.body !== undefined && { payload: options.body as object }),
  });
  const body = res.body ? JSON.parse(res.body) : undefined;
  expectNoActiveSecret(body);
  return { status: res.statusCode, body, headers: res.headers };
}

export async function secretOf(db: Db, gameId: number): Promise<string> {
  const row = await db
    .selectFrom("games")
    .select("secret")
    .where("id", "=", gameId)
    .executeTakeFirstOrThrow();
  return row.secret;
}

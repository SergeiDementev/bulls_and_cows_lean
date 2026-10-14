import Fastify, { type FastifyError } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { LANGUAGES, type ErrorBody, type ErrorCode } from "../shared/api.ts";
import type { Config } from "./config.ts";
import { queryStats, type Db, type QueryStats } from "./db.ts";
import { timingSafeEqual } from "node:crypto";
import { handleUpdate, type Update } from "./bot.ts";
import { AppError, STATUS } from "./errors.ts";
import { verifyInitData, type TelegramUser } from "./init-data.ts";
import { RateLimiter } from "./rate-limit.ts";
import * as scenarios from "./scenarios.ts";

export interface AppDeps {
  db: Db;
  config: Config;
  /** Milliseconds since the epoch; tests move time forward. */
  now?: () => number;
  /** Where log lines go; stdout by default. Tests read them. */
  logStream?: { write(line: string): void };
}

const GuessBody = z.strictObject({ guess: z.string(), attempt: z.number().int() });
const LanguageBody = z.strictObject({ language: z.enum(LANGUAGES) });
const GameParams = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .max(2 ** 31 - 1),
});
const ErrorReport = z.strictObject({
  message: z.string().max(2000),
  stack: z.string().max(10_000).optional(),
  screen: z.string().max(50).optional(),
});

const errorBody = (code: ErrorCode, details?: unknown): ErrorBody => ({
  error: details === undefined ? { code } : { code, details },
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new AppError("request.invalid", details);
  }
  return result.data;
}

export function buildApp({ db, config, now = Date.now, logStream }: AppDeps) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, ...(logStream && { stream: logStream }) },
    // Caddy reaches the server over the private Docker network; only such hops may set the client IP
    trustProxy: "loopback, linklocal, uniquelocal",
    bodyLimit: 16 * 1024,
  });
  // Only JSON bodies are read. Anything else is ignored rather than refused: an empty POST sent with
  // a form content type (PowerShell does this) is fine, and a non-JSON guess fails the schema check
  app.addContentTypeParser("*", (_req, _payload, done) => done(null, undefined));

  const limiter = new RateLimiter();
  // Keyed by the request object itself; plain object keeps Fastify generics out of the way
  const users = new WeakMap<object, TelegramUser>();
  const dbStats = new WeakMap<object, QueryStats>();

  // Everything the request does from here on — handler included — counts into this object
  app.addHook("onRequest", (req, _reply, done) => {
    const stats = { queries: 0, ms: 0 };
    dbStats.set(req, stats);
    queryStats.run(stats, done);
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const header = req.headers.authorization ?? "";
    const result = header.startsWith("tma ")
      ? verifyInitData(
          header.slice(4),
          config.BOT_TOKEN,
          config.INIT_DATA_MAX_AGE_SECONDS,
          Math.floor(now() / 1000),
        )
      : ({ ok: false, error: "auth.unauthorized" } as const);

    const [key, limit] = result.ok
      ? [`player:${result.user.id}`, config.RATE_LIMIT_PER_PLAYER]
      : [`ip:${req.ip}`, config.RATE_LIMIT_PER_IP_UNAUTHORIZED];
    const retryAfter = limiter.hit(key, limit, now());
    if (retryAfter) {
      reply.header("Retry-After", retryAfter);
      throw new AppError("rate.limited");
    }
    if (!result.ok) throw new AppError(result.error);
    users.set(req, result.user);
  });

  app.addHook("onResponse", async (req, reply) => {
    const stats = dbStats.get(req)!;
    if (reply.elapsedTime >= config.SLOW_REQUEST_MS) {
      req.log.warn(
        {
          url: req.url,
          ms: Math.round(reply.elapsedTime),
          dbQueries: stats.queries,
          dbMs: Math.round(stats.ms),
        },
        "slow request",
      );
    }
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(STATUS[error.code]).send(errorBody(error.code, error.details));
    }
    // Fastify's own refusals: malformed JSON, body too large, wrong content type
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(400).send(errorBody("request.invalid", error.message));
    }
    req.log.error({ err: error }, "unexpected error");
    return reply.status(500).send(errorBody("internal.error"));
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send(errorBody("route.not_found")));

  // Present only under /api: the auth hook rejected the request otherwise
  const userOf = (req: object): TelegramUser => users.get(req)!;
  const playerOf = (req: object) => scenarios.findPlayer(db, userOf(req).id);

  app.post("/api/session", (req) => scenarios.openSession(db, userOf(req)));

  app.patch("/api/me", async (req) => {
    const { language } = parse(LanguageBody, req.body);
    return { player: await scenarios.setLanguage(db, (await playerOf(req)).id, language) };
  });

  app.post("/api/games", async (req, reply) => {
    const game = await scenarios.newGame(db, (await playerOf(req)).id, config.GAME_LENGTH);
    return reply.status(201).send(game);
  });

  app.post("/api/games/:id/guesses", async (req) => {
    const { id } = parse(GameParams, req.params);
    const { guess, attempt } = parse(GuessBody, req.body);
    return scenarios.guess(db, (await playerOf(req)).id, id, attempt, guess);
  });

  app.post("/api/games/:id/abandon", async (req) => {
    const { id } = parse(GameParams, req.params);
    return scenarios.abandonGame(db, (await playerOf(req)).id, id);
  });

  app.get("/api/stats", async (req) => scenarios.stats(db, (await playerOf(req)).id));

  app.post("/api/errors", async (req, reply) => {
    const report = parse(ErrorReport, req.body);
    req.log.warn({ clientError: report, telegramUser: userOf(req).id }, "client error");
    return reply.status(202).send();
  });

  const { WEBAPP_URL, WEBHOOK_SECRET } = config;
  if (WEBAPP_URL && WEBHOOK_SECRET) {
    app.post("/telegram/webhook", async (req, reply) => {
      // Telegram sends the secret given in setWebhook; nobody else knows it
      const given = Buffer.from(String(req.headers["x-telegram-bot-api-secret-token"] ?? ""));
      const expected = Buffer.from(WEBHOOK_SECRET);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw new AppError("auth.unauthorized");
      }
      const answer = await handleUpdate(req.body as Update, {
        db,
        webAppUrl: WEBAPP_URL,
        gameLength: config.GAME_LENGTH,
      });
      return answer ?? reply.status(200).send();
    });
  }

  // Closed to the internet by Caddy. Checks the database too: a running process is not a working one
  app.get("/health", async () => {
    await sql`select 1`.execute(db);
    return { status: "ok" };
  });

  return app;
}

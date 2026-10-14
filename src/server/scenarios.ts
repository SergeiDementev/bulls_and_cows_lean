/** What a player can do. Each scenario is one transaction: rules from domain, storage here. */
import { randomInt } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import { abandon, makeGuess, startGame, type Game } from "../domain/game.ts";
import {
  isRanked,
  playerStats,
  RATING_RULES,
  ratingSummary,
  type FinishedGame,
} from "../domain/stats.ts";
import type { GameView, Language, PlayerView, SessionView, StatsView } from "../shared/api.ts";
import type { Database, Db } from "./db.ts";
import { AppError } from "./errors.ts";
import type { TelegramUser } from "./init-data.ts";

type Trx = Transaction<Database>;
type GameRow = Selectable<Database["games"]>;
type GuessRow = Pick<Selectable<Database["guesses"]>, (typeof GUESS_COLUMNS)[number]>;

const PLAYER_COLUMNS = ["id", "username", "language"] as const;
const GUESS_COLUMNS = ["attempt_no", "value", "bulls", "cows", "remaining"] as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Language is chosen once, at registration; later the player may switch it themselves. */
const languageFrom = (code: string | null): Language =>
  code?.toLowerCase().startsWith("ru") ? "ru" : "en";

/** The only place a GameView is built, so the secret cannot leak from some other path. */
function toGameView(game: GameRow, guesses: readonly GuessRow[]): GameView {
  return {
    id: game.id,
    status: game.status,
    length: game.length,
    attempts: guesses.map((g) => ({
      number: g.attempt_no,
      guess: g.value,
      bulls: g.bulls,
      cows: g.cows,
    })),
    remaining: guesses.at(-1)?.remaining ?? null,
    secret: game.status === "active" ? null : game.secret,
  };
}

const toDomain = (game: GameRow, guesses: readonly GuessRow[]): Game => ({
  length: game.length,
  secret: game.secret,
  status: game.status,
  attempts: guesses.map((g) => ({ guess: g.value, bulls: g.bulls, cows: g.cows })),
});

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e.code === "23505" && e.constraint === constraint;
}

async function guessesOf(db: Db | Trx, gameId: number): Promise<GuessRow[]> {
  return db
    .selectFrom("guesses")
    .select(GUESS_COLUMNS)
    .where("game_id", "=", gameId)
    .orderBy("attempt_no")
    .execute();
}

/** Locks the game row so two moves in the same game run one after another. */
async function lockGame(trx: Trx, playerId: number, gameId: number) {
  const game = await trx
    .selectFrom("games")
    .selectAll()
    .where("id", "=", gameId)
    // Someone else's game is "not found": we do not reveal that it exists
    .where("player_id", "=", playerId)
    .forUpdate()
    .executeTakeFirst();
  if (!game) throw new AppError("game.not_found");
  return { game, guesses: await guessesOf(trx, gameId) };
}

/** Rebuilds the player's rating summary from history, in the transaction that finished a game. */
async function refreshRating(trx: Trx, playerId: number): Promise<void> {
  const summary = ratingSummary(await finishedGames(trx, playerId));
  await trx
    .updateTable("players")
    .set({
      rating_average: summary?.average ?? null,
      rating_wins: summary?.recentWins ?? null,
      rating_games: summary?.games ?? null,
    })
    .where("id", "=", playerId)
    .execute();
}

/** Status and move count of every finished game, oldest first — no moves are read. */
async function finishedGames(db: Db | Trx, playerId: number): Promise<FinishedGame[]> {
  const rows = await db
    .selectFrom("games")
    .select(["status", "attempt_count"])
    .where("player_id", "=", playerId)
    .where("status", "!=", "active")
    .orderBy("finished_at")
    .orderBy("id")
    .execute();
  return rows.map((r) => ({
    status: r.status as FinishedGame["status"],
    attempts: r.attempt_count,
  }));
}

export async function openSession(db: Db, user: TelegramUser): Promise<SessionView> {
  const player = await db
    .insertInto("players")
    .values({
      telegram_id: user.id,
      username: user.username,
      language: languageFrom(user.languageCode),
    })
    .onConflict((oc) =>
      oc.column("telegram_id").doUpdateSet((eb) => ({ username: eb.ref("excluded.username") })),
    )
    .returning(PLAYER_COLUMNS)
    .executeTakeFirstOrThrow();

  const game = await db
    .selectFrom("games")
    .selectAll()
    .where("player_id", "=", player.id)
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return { player, game: game ? toGameView(game, await guessesOf(db, game.id)) : null };
}

export async function findPlayer(db: Db, telegramId: number): Promise<PlayerView> {
  const player = await db
    .selectFrom("players")
    .select(PLAYER_COLUMNS)
    .where("telegram_id", "=", String(telegramId))
    .executeTakeFirst();
  if (!player) throw new AppError("player.not_found");
  return player;
}

export async function setLanguage(
  db: Db,
  playerId: number,
  language: Language,
): Promise<PlayerView> {
  return db
    .updateTable("players")
    .set({ language })
    .where("id", "=", playerId)
    .returning(PLAYER_COLUMNS)
    .executeTakeFirstOrThrow();
}

export async function newGame(db: Db, playerId: number, length: number): Promise<GameView> {
  const last = await db
    .selectFrom("games")
    .select("status")
    .where("player_id", "=", playerId)
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  const started = startGame(last?.status ?? null, length, randomInt);
  if (!started.ok) throw new AppError(started.error);

  try {
    const game = await db
      .insertInto("games")
      .values({ player_id: playerId, length, secret: started.value.secret, status: "active" })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toGameView(game, []);
  } catch (error) {
    if (isUniqueViolation(error, "games_one_active_per_player"))
      throw new AppError("game.already_active");
    throw error;
  }
}

export async function guess(
  db: Db,
  playerId: number,
  gameId: number,
  attemptNo: number,
  input: string,
): Promise<GameView> {
  return db.transaction().execute(async (trx) => {
    const { game, guesses } = await lockGame(trx, playerId, gameId);
    const result = makeGuess(toDomain(game, guesses), attemptNo, input);
    if (!result.ok) throw new AppError(result.error);

    const { attempt, remaining, game: next } = result.value;
    const added = await trx
      .insertInto("guesses")
      .values({
        game_id: gameId,
        attempt_no: attemptNo,
        value: attempt.guess,
        bulls: attempt.bulls,
        cows: attempt.cows,
        remaining,
      })
      .returning(GUESS_COLUMNS)
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        // The row lock already orders moves; this is the database's last word if it ever does not
        if (isUniqueViolation(error, "guesses_pk")) throw new AppError("guess.attempt_mismatch");
        throw error;
      });
    const updated = await trx
      .updateTable("games")
      .set({
        status: next.status,
        attempt_count: next.attempts.length,
        finished_at: next.status === "active" ? null : new Date(),
      })
      .where("id", "=", gameId)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (next.status !== "active") await refreshRating(trx, playerId);
    return toGameView(updated, [...guesses, added]);
  });
}

export async function abandonGame(db: Db, playerId: number, gameId: number): Promise<GameView> {
  return db.transaction().execute(async (trx) => {
    const { game, guesses } = await lockGame(trx, playerId, gameId);
    const result = abandon(toDomain(game, guesses));
    if (!result.ok) throw new AppError(result.error);

    const updated = await trx
      .updateTable("games")
      .set({ status: "abandoned", finished_at: new Date() })
      .where("id", "=", gameId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await refreshRating(trx, playerId);
    return toGameView(updated, guesses);
  });
}

export async function stats(db: Db, playerId: number, rules = RATING_RULES): Promise<StatsView> {
  const own = playerStats(await finishedGames(db, playerId), rules);
  const recent = own.recent;

  let place: number | null = null;
  if (recent && isRanked(recent, rules)) {
    const { better } = await db
      .selectFrom("players")
      .select((eb) => eb.fn.countAll<string>().as("better"))
      .where("rating_wins", ">=", rules.minWins)
      .where((eb) =>
        eb.or([
          eb("rating_average", "<", recent.average),
          eb.and([
            eb("rating_average", "=", recent.average),
            eb("rating_wins", ">", recent.recentWins),
          ]),
          eb.and([
            eb("rating_average", "=", recent.average),
            eb("rating_wins", "=", recent.recentWins),
            eb("id", "<", playerId),
          ]),
        ]),
      )
      .executeTakeFirstOrThrow();
    place = Number(better) + 1;
  }

  const top = await db
    .selectFrom("players")
    .select(["id", "username", "rating_average", "rating_wins"])
    .where("rating_wins", ">=", rules.minWins)
    .orderBy("rating_average")
    .orderBy("rating_wins", "desc")
    .orderBy("id")
    .limit(10)
    .execute();

  return {
    window: rules.window,
    minWins: rules.minWins,
    me: {
      gamesPlayed: own.gamesPlayed,
      wins: own.wins,
      bestResult: own.bestResult,
      averageAttempts: recent ? round2(recent.average) : null,
      averageGames: recent?.games ?? 0,
      recentWins: recent?.recentWins ?? 0,
      place,
    },
    top: top.map((p, i) => ({
      place: i + 1,
      playerId: p.id,
      username: p.username,
      averageAttempts: round2(p.rating_average!),
      recentWins: p.rating_wins!,
    })),
  };
}

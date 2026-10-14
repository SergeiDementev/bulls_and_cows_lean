/** Game states and allowed actions (docs/rules.md, «Состояния партии»). */
import {
  assertLength,
  generateSecret,
  remainingCount,
  score,
  validateGuess,
  type InputError,
  type RandomInt,
  type Score,
} from "./code.ts";

export type Status = "active" | "won" | "abandoned";

export interface Attempt extends Score {
  guess: string;
}

export interface Game {
  readonly length: number;
  readonly secret: string;
  readonly status: Status;
  readonly attempts: readonly Attempt[];
}

export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export type GuessError = "game.not_active" | "guess.attempt_mismatch" | InputError;

export interface GuessOutcome {
  game: Game;
  attempt: Attempt;
  remaining: number;
}

/** `lastStatus` is the status of the player's latest game, or null if there was none. */
export function startGame(
  lastStatus: Status | null,
  length: number,
  randomInt: RandomInt,
): Result<Game, "game.already_active"> {
  assertLength(length);
  if (lastStatus === "active") return { ok: false, error: "game.already_active" };
  return {
    ok: true,
    value: { length, secret: generateSecret(length, randomInt), status: "active", attempts: [] },
  };
}

/**
 * `attemptNo` is the number the client expects this move to get. A mismatch means a repeated
 * request or a stale screen, so it is checked before the guess itself.
 */
export function makeGuess(
  game: Game,
  attemptNo: number,
  input: string,
): Result<GuessOutcome, GuessError> {
  if (game.status !== "active") return { ok: false, error: "game.not_active" };
  if (attemptNo !== game.attempts.length + 1) return { ok: false, error: "guess.attempt_mismatch" };
  const inputError = validateGuess(input, game.length);
  if (inputError) return { ok: false, error: inputError };

  const attempt: Attempt = { guess: input, ...score(game.secret, input) };
  const attempts = [...game.attempts, attempt];
  const status: Status = attempt.bulls === game.length ? "won" : "active";
  return {
    ok: true,
    value: {
      game: { ...game, status, attempts },
      attempt,
      remaining: remainingCount(game.length, attempts),
    },
  };
}

export function abandon(game: Game): Result<Game, "game.not_active"> {
  if (game.status !== "active") return { ok: false, error: "game.not_active" };
  return { ok: true, value: { ...game, status: "abandoned" } };
}

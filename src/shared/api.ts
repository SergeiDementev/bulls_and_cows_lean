/** Request and response shapes shared by the server and the Mini App (docs/api.md). */

export const LANGUAGES = ["ru", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export type GameStatus = "active" | "won" | "abandoned";

export interface PlayerView {
  id: number;
  username: string | null;
  language: Language;
}

export interface AttemptView {
  number: number;
  guess: string;
  bulls: number;
  cows: number;
}

export interface GameView {
  id: number;
  status: GameStatus;
  length: number;
  attempts: AttemptView[];
  /** null before the first move */
  remaining: number | null;
  /** null while the game is active */
  secret: string | null;
}

export interface SessionView {
  player: PlayerView;
  game: GameView | null;
  /** Digits in a new game: what the rules show before the first game. */
  gameLength: number;
}

export interface StatsView {
  window: number;
  minWins: number;
  me: {
    gamesPlayed: number;
    wins: number;
    bestResult: number | null;
    averageAttempts: number | null;
    averageGames: number;
    recentWins: number;
    place: number | null;
  };
  top: {
    place: number;
    playerId: number;
    username: string | null;
    averageAttempts: number;
    recentWins: number;
  }[];
}

export interface GuessRequest {
  guess: string;
  attempt: number;
}

export type ErrorCode =
  | "request.invalid"
  | "guess.invalid_format"
  | "guess.wrong_length"
  | "guess.digits_not_unique"
  | "auth.unauthorized"
  | "auth.init_data_expired"
  | "route.not_found"
  | "player.not_found"
  | "game.not_found"
  | "game.not_active"
  | "game.already_active"
  | "guess.attempt_mismatch"
  | "rate.limited"
  | "internal.error";

export interface ErrorBody {
  error: { code: ErrorCode; details?: unknown };
}

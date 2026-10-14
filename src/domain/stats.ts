/** Player statistics and rating (docs/rules.md, «Статистика игрока», «Рейтинг»). */

export interface FinishedGame {
  status: "won" | "abandoned";
  attempts: number;
}

export interface RatingRules {
  /** How many latest games the average and the win threshold look at. */
  window: number;
  /** An abandoned game with moves counts as this many attempts, or as its moves if more. */
  abandonPenalty: number;
  /** Wins among the latest `window` games needed to enter the rating. */
  minWins: number;
}

export const RATING_RULES: RatingRules = { window: 20, abandonPenalty: 10, minWins: 5 };

export interface RatingSummary {
  average: number;
  recentWins: number;
  /** How many games the average is over: 1 to `window`. */
  games: number;
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  bestResult: number | null;
  /** The same summary the rating uses; null until the first game. */
  recent: RatingSummary | null;
}

export interface RankedPlayer extends RatingSummary {
  /** Registration order: on equal results the earlier player ranks higher. */
  playerId: number;
}

/** An abandoned game without a single move is not a game: the player changed their mind. */
const isGame = (g: FinishedGame): boolean => g.status === "won" || g.attempts > 0;

const gameAttempts = (g: FinishedGame, rules: RatingRules): number =>
  g.status === "won" ? g.attempts : Math.max(rules.abandonPenalty, g.attempts);

/** `history` is the player's finished games, oldest first. */
export function ratingSummary(
  history: readonly FinishedGame[],
  rules: RatingRules = RATING_RULES,
): RatingSummary | null {
  const recent = history.filter(isGame).slice(-rules.window);
  if (recent.length === 0) return null;
  const total = recent.reduce((sum, g) => sum + gameAttempts(g, rules), 0);
  return {
    average: total / recent.length,
    recentWins: recent.filter((g) => g.status === "won").length,
    games: recent.length,
  };
}

/** `history` is the player's finished games, oldest first. */
export function playerStats(
  history: readonly FinishedGame[],
  rules: RatingRules = RATING_RULES,
): PlayerStats {
  const games = history.filter(isGame);
  const wins = games.filter((g) => g.status === "won");
  return {
    gamesPlayed: games.length,
    wins: wins.length,
    bestResult: wins.reduce<number | null>(
      (best, g) => Math.min(best ?? g.attempts, g.attempts),
      null,
    ),
    recent: ratingSummary(games, rules),
  };
}

export const isRanked = (s: RatingSummary, rules: RatingRules = RATING_RULES): boolean =>
  s.recentWins >= rules.minWins;

/** Rating order: lower average first, then more recent wins, then earlier registration. */
export function compareRanked(a: RankedPlayer, b: RankedPlayer): number {
  return a.average - b.average || b.recentWins - a.recentWins || a.playerId - b.playerId;
}

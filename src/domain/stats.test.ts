import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compareRanked,
  isRanked,
  playerStats,
  RATING_RULES,
  ratingSummary,
  type FinishedGame,
  type RankedPlayer,
} from "./stats.ts";

const won = (attempts: number): FinishedGame => ({ status: "won", attempts });
const quit = (attempts: number): FinishedGame => ({ status: "abandoned", attempts });

const finishedGame = fc.oneof(
  fc.integer({ min: 1, max: 30 }).map(won),
  fc.integer({ min: 0, max: 30 }).map(quit),
);
const history = fc.array(finishedGame, { maxLength: 60 });

describe("playerStats", () => {
  it("is empty before the first game", () => {
    expect(playerStats([])).toEqual({ gamesPlayed: 0, wins: 0, bestResult: null, recent: null });
  });

  it("counts wins and abandoned games with moves", () => {
    expect(playerStats([won(6), quit(3), won(4)])).toEqual({
      gamesPlayed: 3,
      wins: 2,
      bestResult: 4,
      recent: { average: (6 + 10 + 4) / 3, recentWins: 2, games: 3 },
    });
  });

  it("ignores an abandoned game without moves", () => {
    expect(playerStats([quit(0)])).toEqual(playerStats([]));
    expect(playerStats([won(5), quit(0), won(7)])).toEqual(playerStats([won(5), won(7)]));
  });

  it("has no best result without a win", () => {
    expect(playerStats([quit(2)]).bestResult).toBeNull();
  });

  it("keeps the best result from the whole history, outside the window too", () => {
    const games = [won(2), ...Array.from({ length: 20 }, () => won(7))];
    expect(playerStats(games).bestResult).toBe(2);
    expect(playerStats(games).recent?.average).toBe(7);
  });

  it("uses the same summary as the rating", () => {
    fc.assert(
      fc.property(history, (h) => {
        expect(playerStats(h).recent).toEqual(ratingSummary(h));
      }),
    );
  });
});

describe("ratingSummary", () => {
  it("counts an abandoned game as 10 attempts, or as its moves if more", () => {
    expect(ratingSummary([quit(3)])?.average).toBe(10);
    expect(ratingSummary([quit(10)])?.average).toBe(10);
    expect(ratingSummary([quit(12)])?.average).toBe(12);
  });

  it("looks only at the latest 20 games", () => {
    const old = Array.from({ length: 5 }, () => won(1));
    const recent = Array.from({ length: 20 }, () => won(6));
    expect(ratingSummary([...old, ...recent])).toEqual({ average: 6, recentWins: 20, games: 20 });
  });

  it("does not let no-move games push real games out of the window", () => {
    const games = [won(1), ...Array.from({ length: 19 }, () => won(5)), quit(0), quit(0)];
    expect(ratingSummary(games)?.games).toBe(20);
    expect(ratingSummary(games)?.average).toBe((1 + 19 * 5) / 20);
  });

  it("takes the rules as a parameter", () => {
    const rules = { window: 2, abandonPenalty: 8, minWins: 1 };
    expect(ratingSummary([won(1), won(3), quit(2)], rules)).toEqual({
      average: (3 + 8) / 2,
      recentWins: 1,
      games: 2,
    });
  });

  it("stays within bounds", () => {
    fc.assert(
      fc.property(history, (h) => {
        const s = ratingSummary(h);
        if (!s) return h.every((g) => g.status === "abandoned" && g.attempts === 0);
        return (
          s.games >= 1 &&
          s.games <= RATING_RULES.window &&
          s.recentWins <= s.games &&
          s.average >= 1
        );
      }),
    );
  });
});

describe("isRanked", () => {
  it("needs 5 wins among the latest games", () => {
    expect(isRanked({ average: 5, recentWins: 4, games: 20 })).toBe(false);
    expect(isRanked({ average: 5, recentWins: 5, games: 5 })).toBe(true);
  });
});

describe("compareRanked", () => {
  const player = (playerId: number, average: number, recentWins: number): RankedPlayer => ({
    playerId,
    average,
    recentWins,
    games: 20,
  });

  it("puts a lower average first, then more wins, then earlier registration", () => {
    const players = [player(1, 6, 9), player(2, 5.5, 5), player(3, 6, 12), player(4, 6, 9)];
    expect(players.sort(compareRanked).map((p) => p.playerId)).toEqual([2, 3, 1, 4]);
  });

  it("is a consistent order", () => {
    const ranked = fc.record({
      playerId: fc.integer({ min: 1, max: 5 }),
      average: fc.constantFrom(5, 5.5, 6),
      recentWins: fc.integer({ min: 5, max: 7 }),
      games: fc.constant(20),
    });
    fc.assert(
      fc.property(ranked, ranked, (a, b) => {
        const ab = Math.sign(compareRanked(a, b));
        return (
          ab === -Math.sign(compareRanked(b, a)) &&
          (ab === 0) ===
            (a.playerId === b.playerId && a.average === b.average && a.recentWins === b.recentWins)
        );
      }),
    );
  });
});

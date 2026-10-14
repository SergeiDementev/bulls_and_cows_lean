import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allCodes } from "../domain/code.ts";
import { ratingSummary, type FinishedGame } from "../domain/stats.ts";
import { call, secretOf, useServer, type TestUser } from "./test-helpers.ts";

const me: TestUser = { id: 100, username: "me" };

describe("stats and rating", () => {
  const ctx = useServer();

  /** Plays one game through the API: `attempts` moves, the last one wins unless abandoned. */
  async function play(user: TestUser, game: FinishedGame): Promise<void> {
    const id = (await call(ctx, "POST", "/api/games", { user })).body.id;
    const secret = await secretOf(ctx.db, id);
    const miss = allCodes(4).find((c) => c !== secret)!;
    const misses = game.status === "won" ? game.attempts - 1 : game.attempts;
    for (let n = 1; n <= misses; n++) {
      const res = await call(ctx, "POST", `/api/games/${id}/guesses`, {
        user,
        body: { guess: miss, attempt: n },
      });
      expect(res.status).toBe(200);
    }
    if (game.status === "won") {
      const body = { guess: secret, attempt: game.attempts };
      expect(
        (await call(ctx, "POST", `/api/games/${id}/guesses`, { user, body })).body.status,
      ).toBe("won");
    } else {
      expect((await call(ctx, "POST", `/api/games/${id}/abandon`, { user })).status).toBe(200);
    }
  }

  /** Puts a finished-looking player straight into the table: the rating only reads the summary. */
  async function rankedPlayer(username: string | null, average: number, wins: number) {
    const row = await ctx.db
      .insertInto("players")
      .values({
        telegram_id: Math.floor(Math.random() * 1e9) + 1000,
        username,
        language: "en",
        rating_average: average,
        rating_wins: wins,
        rating_games: 20,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  const statsOf = async (user: TestUser) => (await call(ctx, "GET", "/api/stats", { user })).body;

  it("is empty before the first game", async () => {
    await call(ctx, "POST", "/api/session", { user: me });
    expect(await statsOf(me)).toEqual({
      window: 20,
      minWins: 5,
      me: {
        gamesPlayed: 0,
        wins: 0,
        bestResult: null,
        averageAttempts: null,
        averageGames: 0,
        recentWins: 0,
        place: null,
      },
      top: [],
    });
  });

  it("counts games by the rules", async () => {
    await call(ctx, "POST", "/api/session", { user: me });
    await play(me, { status: "won", attempts: 3 });
    await play(me, { status: "abandoned", attempts: 2 });
    await play(me, { status: "abandoned", attempts: 0 });
    await play(me, { status: "won", attempts: 1 });
    expect((await statsOf(me)).me).toEqual({
      gamesPlayed: 3,
      wins: 2,
      bestResult: 1,
      averageAttempts: 4.67, // (3 + 10 + 1) / 3, rounded
      averageGames: 3,
      recentWins: 2,
      place: null,
    });
  });

  it("ranks by average, then wins, then registration, and shows the top 10", async () => {
    await call(ctx, "POST", "/api/session", { user: me });
    for (let i = 0; i < 5; i++) await play(me, { status: "won", attempts: 2 });

    const better = await rankedPlayer("fast", 1.5, 5);
    const sameAverageMoreWins = await rankedPlayer(null, 2, 9);
    const sameButLater = await rankedPlayer("later", 2, 5);
    await rankedPlayer("too_few_wins", 1, 4);
    for (let i = 0; i < 8; i++) await rankedPlayer(`slow${i}`, 3 + i, 5);

    const stats = await statsOf(me);
    expect(stats.top).toHaveLength(10);
    expect(stats.top.slice(0, 3).map((p: { playerId: number }) => p.playerId)).toEqual([
      better,
      sameAverageMoreWins,
      1, // me: average 2 with 5 wins, registered before "later"
    ]);
    expect(stats.top[1]).toEqual({
      place: 2,
      playerId: sameAverageMoreWins,
      username: null,
      averageAttempts: 2,
      recentWins: 9,
    });
    expect(stats.top.map((p: { playerId: number }) => p.playerId)).toContain(sameButLater);
    expect(stats.top.map((p: { username: string }) => p.username)).not.toContain("too_few_wins");
    expect(stats.me.place).toBe(3);
  });

  it("gives a place outside the top 10", async () => {
    for (let i = 0; i < 12; i++) await rankedPlayer(`p${i}`, 1 + i / 10, 5);
    await call(ctx, "POST", "/api/session", { user: me });
    for (let i = 0; i < 5; i++) await play(me, { status: "won", attempts: 3 });
    const stats = await statsOf(me);
    expect(stats.me.place).toBe(13);
    expect(stats.top.map((p: { playerId: number }) => p.playerId)).not.toContain(13);
  });

  it("stores the same summary the rules compute", { timeout: 60_000 }, async () => {
    const game = fc.oneof(
      fc.integer({ min: 1, max: 3 }).map((attempts): FinishedGame => ({ status: "won", attempts })),
      fc
        .integer({ min: 0, max: 2 })
        .map((attempts): FinishedGame => ({ status: "abandoned", attempts })),
    );
    let user = 1000;
    await fc.assert(
      fc.asyncProperty(fc.array(game, { minLength: 1, maxLength: 24 }), async (history) => {
        const player = { id: ++user };
        const { id } = (await call(ctx, "POST", "/api/session", { user: player })).body.player;
        for (const g of history) await play(player, g);

        const row = await ctx.db
          .selectFrom("players")
          .select(["rating_average", "rating_wins", "rating_games"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
        const expected = ratingSummary(history);
        expect(row).toEqual({
          rating_average: expected?.average ?? null,
          rating_wins: expected?.recentWins ?? null,
          rating_games: expected?.games ?? null,
        });
      }),
      { numRuns: 8 },
    );
  });
});

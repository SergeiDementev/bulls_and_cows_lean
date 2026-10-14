import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { remainingCount, score } from "./code.ts";
import { abandon, makeGuess, startGame, type Game, type Status } from "./game.ts";

const game = (status: Status, guesses: string[] = []): Game => ({
  length: 4,
  secret: "5017",
  status,
  attempts: guesses.map((guess) => ({ guess, ...score("5017", guess) })),
});

const firstPick = () => 0;

describe("startGame", () => {
  it.each([null, "won", "abandoned"] as const)("starts after %s", (last) => {
    const result = startGame(last, 4, firstPick);
    expect(result).toEqual({
      ok: true,
      value: { length: 4, secret: "0123", status: "active", attempts: [] },
    });
  });

  it("refuses while a game is active", () => {
    expect(startGame("active", 4, firstPick)).toEqual({ ok: false, error: "game.already_active" });
  });

  it("takes the length as a parameter", () => {
    const result = startGame(null, 6, firstPick);
    expect(result.ok && result.value.secret).toBe("012345");
  });

  it("rejects an unsupported length", () => {
    expect(() => startGame(null, 0, firstPick)).toThrow(RangeError);
  });
});

describe("makeGuess", () => {
  it("records a miss and keeps the game active", () => {
    const result = makeGuess(game("active", ["0123"]), 2, "5103");
    expect(result).toEqual({
      ok: true,
      value: {
        game: game("active", ["0123", "5103"]),
        attempt: { guess: "5103", bulls: 1, cows: 2 },
        remaining: remainingCount(4, game("active", ["0123", "5103"]).attempts),
      },
    });
  });

  it("wins on all bulls", () => {
    const result = makeGuess(game("active", ["0123"]), 2, "5017");
    expect(result.ok && result.value.game.status).toBe("won");
    expect(result.ok && result.value.remaining).toBe(1);
  });

  it("counts a repeated guess as a new move", () => {
    const result = makeGuess(game("active", ["0123"]), 2, "0123");
    expect(result.ok && result.value.game.attempts).toHaveLength(2);
  });

  it.each(["won", "abandoned"] as const)("refuses in a %s game", (status) => {
    expect(makeGuess(game(status, ["0123"]), 2, "4567")).toEqual({
      ok: false,
      error: "game.not_active",
    });
  });

  it.each([1, 3, 0, -1, 2.5])("refuses attempt number %s when 2 is expected", (n) => {
    expect(makeGuess(game("active", ["0123"]), n, "4567")).toEqual({
      ok: false,
      error: "guess.attempt_mismatch",
    });
  });

  it.each([
    ["12a4", "guess.invalid_format"],
    ["123", "guess.wrong_length"],
    ["1124", "guess.digits_not_unique"],
  ])("refuses input %j with %s", (input, error) => {
    expect(makeGuess(game("active"), 1, input)).toEqual({ ok: false, error });
  });

  it("checks the game, then the attempt number, then the input", () => {
    expect(makeGuess(game("won"), 9, "x")).toEqual({ ok: false, error: "game.not_active" });
    expect(makeGuess(game("active"), 9, "x")).toEqual({
      ok: false,
      error: "guess.attempt_mismatch",
    });
  });

  it("does not change the game it was given", () => {
    const before = game("active", ["0123"]);
    makeGuess(before, 2, "5017");
    expect(before).toEqual(game("active", ["0123"]));
  });

  it("numbers moves without gaps and stops exactly at the win", () => {
    fc.assert(
      fc.property(
        fc.array(fc.shuffledSubarray([..."0123456789"], { minLength: 4, maxLength: 4 }), {
          maxLength: 15,
        }),
        (picks) => {
          let current = game("active");
          for (const guess of picks.map((d) => d.join(""))) {
            const result = makeGuess(current, current.attempts.length + 1, guess);
            if (current.status !== "active") return !result.ok;
            if (!result.ok) return false;
            current = result.value.game;
            if ((current.status === "won") !== (guess === "5017")) return false;
          }
          return true;
        },
      ),
    );
  });
});

describe("abandon", () => {
  it("ends an active game", () => {
    expect(abandon(game("active", ["0123"]))).toEqual({
      ok: true,
      value: game("abandoned", ["0123"]),
    });
  });

  it.each(["won", "abandoned"] as const)("refuses in a %s game", (status) => {
    expect(abandon(game(status))).toEqual({ ok: false, error: "game.not_active" });
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  allCodes,
  assertLength,
  generateSecret,
  MAX_LENGTH,
  remainingCount,
  score,
  validateGuess,
} from "./code.ts";

const DIGITS = [..."0123456789"];
const length = fc.integer({ min: 1, max: 6 });
/** A valid code of the given length: distinct digits in random order. */
const codeOf = (n: number) =>
  fc.shuffledSubarray(DIGITS, { minLength: n, maxLength: n }).map((d) => d.join(""));
const twoCodes = length.chain((n) => fc.tuple(codeOf(n), codeOf(n)));

describe("assertLength", () => {
  it.each([1, 4, MAX_LENGTH])("accepts %s", (n) => {
    expect(() => assertLength(n)).not.toThrow();
  });

  it.each([0, -1, 11, 4.5, Number.NaN])("rejects %s", (n) => {
    expect(() => assertLength(n)).toThrow(RangeError);
  });
});

describe("validateGuess", () => {
  it.each([
    ["0123", null],
    ["9876", null],
    ["11a", "guess.invalid_format"],
    ["12 4", "guess.invalid_format"],
    [" 1234", "guess.invalid_format"],
    ["١٢٣٤", "guess.invalid_format"], // Arabic-Indic digits
    ["１２３４", "guess.invalid_format"], // full-width digits
    ["-123", "guess.invalid_format"],
    ["", "guess.wrong_length"],
    ["112", "guess.wrong_length"],
    ["01234", "guess.wrong_length"],
    ["1123", "guess.digits_not_unique"],
    ["0000", "guess.digits_not_unique"],
  ])("%j → %s", (input, expected) => {
    expect(validateGuess(input, 4)).toBe(expected);
  });

  it("accepts every valid code", () => {
    fc.assert(
      fc.property(length.chain(codeOf), (code) => validateGuess(code, code.length) === null),
    );
  });

  it("reports a format error first, whatever else is wrong", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom("a", " ", "٣", "x"), length, (s, bad, n) => {
        return validateGuess(s + bad, n) === "guess.invalid_format";
      }),
    );
  });
});

describe("score", () => {
  it.each([
    ["5017", "0123", 0, 2],
    ["5017", "5103", 1, 2],
    ["5017", "5017", 4, 0],
    ["5017", "2346", 0, 0],
    ["5017", "7105", 0, 4],
  ])("secret %s, guess %s → %i bulls, %i cows", (secret, guess, bulls, cows) => {
    expect(score(secret, guess)).toEqual({ bulls, cows });
  });

  it("bulls + cows is the number of shared digits", () => {
    fc.assert(
      fc.property(twoCodes, ([a, b]) => {
        const { bulls, cows } = score(a, b);
        const shared = [...a].filter((d) => b.includes(d)).length;
        return bulls + cows === shared;
      }),
    );
  });

  it("is symmetric", () => {
    fc.assert(
      fc.property(twoCodes, ([a, b]) => {
        expect(score(a, b)).toEqual(score(b, a));
      }),
    );
  });

  it("gives all bulls only for the secret itself", () => {
    fc.assert(fc.property(twoCodes, ([a, b]) => (score(a, b).bulls === a.length) === (a === b)));
  });
});

describe("generateSecret", () => {
  it("always returns a valid code", () => {
    fc.assert(
      fc.property(length, fc.infiniteStream(fc.nat()), (n, stream) => {
        const values = stream[Symbol.iterator]();
        const secret = generateSecret(n, (max) => values.next().value % max);
        return validateGuess(secret, n) === null;
      }),
    );
  });

  it("can put zero first", () => {
    expect(generateSecret(4, () => 0)).toBe("0123");
  });

  it("reaches every code: one random choice per position", () => {
    // Each sequence of choices is one code, so all 10 × 9 = 90 two-digit codes appear exactly once
    const seen = new Set<string>();
    for (let a = 0; a < 10; a++)
      for (let b = 0; b < 9; b++) {
        const picks = [a, b];
        seen.add(generateSecret(2, () => picks.shift()!));
      }
    expect(seen).toEqual(new Set(allCodes(2)));
  });

  it("rejects an unsupported length", () => {
    expect(() => generateSecret(11, () => 0)).toThrow(RangeError);
  });
});

describe("allCodes", () => {
  it.each([
    [1, 10],
    [2, 90],
    [4, 5040],
  ])("length %i has %i codes, all valid and distinct", (n, count) => {
    const codes = allCodes(n);
    expect(codes).toHaveLength(count);
    expect(new Set(codes).size).toBe(count);
    expect(codes.every((c) => validateGuess(c, n) === null)).toBe(true);
  });

  it("builds the list once per length", () => {
    expect(allCodes(4)).toBe(allCodes(4));
  });
});

describe("remainingCount", () => {
  it("is every code before the first move", () => {
    expect(remainingCount(4, [])).toBe(5040);
  });

  it("leaves 6 × 5 × 4 × 3 = 360 codes after a guess with no bulls and no cows", () => {
    expect(remainingCount(4, [{ guess: "0123", bulls: 0, cows: 0 }])).toBe(360);
  });

  it("matches checking score() against every code", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 4 })
          .chain((n) => fc.tuple(codeOf(n), fc.array(codeOf(n), { maxLength: 5 }))),
        ([secret, guesses]) => {
          const attempts = guesses.map((guess) => ({ guess, ...score(secret, guess) }));
          const expected = allCodes(secret.length).filter((code) =>
            attempts.every((a) => {
              const s = score(code, a.guess);
              return s.bulls === a.bulls && s.cows === a.cows;
            }),
          ).length;
          return remainingCount(secret.length, attempts) === expected;
        },
      ),
    );
  });

  it("is 1 after the winning guess", () => {
    expect(remainingCount(4, [{ guess: "5017", bulls: 4, cows: 0 }])).toBe(1);
  });

  it("never drops to zero and never grows as moves are added", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 4 })
          .chain((n) => fc.tuple(codeOf(n), fc.array(codeOf(n), { maxLength: 6 }))),
        ([secret, guesses]) => {
          const attempts = guesses.map((guess) => ({ guess, ...score(secret, guess) }));
          let previous = allCodes(secret.length).length;
          for (let i = 0; i <= attempts.length; i++) {
            const count = remainingCount(secret.length, attempts.slice(0, i));
            if (count < 1 || count > previous) return false;
            previous = count;
          }
          return true;
        },
      ),
    );
  });
});

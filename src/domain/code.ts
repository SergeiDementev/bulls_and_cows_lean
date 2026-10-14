/** Numbers with distinct digits 0–9: the secret and every guess (docs/rules.md, «Число»). */

export const MAX_LENGTH = 10;

export type InputError = "guess.invalid_format" | "guess.wrong_length" | "guess.digits_not_unique";

export interface Score {
  bulls: number;
  cows: number;
}

/** Returns a random integer in [0, maxExclusive). The server passes crypto.randomInt. */
export type RandomInt = (maxExclusive: number) => number;

export function assertLength(length: number): void {
  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    throw new RangeError(`length must be an integer from 1 to ${MAX_LENGTH}, got ${length}`);
  }
}

/** Checks a guess in the documented order and reports only the first error. */
export function validateGuess(input: string, length: number): InputError | null {
  // ASCII only: digits from other scripts are a format error too
  if (!/^[0-9]*$/.test(input)) return "guess.invalid_format";
  if (input.length !== length) return "guess.wrong_length";
  if (new Set(input).size !== input.length) return "guess.digits_not_unique";
  return null;
}

/** Expects two valid codes of the same length. */
export function score(secret: string, guess: string): Score {
  let bulls = 0;
  let cows = 0;
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === secret[i]) bulls++;
    else if (secret.includes(guess[i]!)) cows++;
  }
  return { bulls, cows };
}

/** Partial Fisher–Yates shuffle: every code of the length is equally likely. */
export function generateSecret(length: number, randomInt: RandomInt): string {
  assertLength(length);
  const digits = [..."0123456789"];
  for (let i = 0; i < length; i++) {
    const j = i + randomInt(digits.length - i);
    [digits[i], digits[j]] = [digits[j]!, digits[i]!];
  }
  return digits.slice(0, length).join("");
}

const codesByLength = new Map<number, readonly string[]>();

/**
 * Every code of the length: 10 × 9 × … (length factors). Built once per length and kept,
 * because the remaining-count runs on every move (v1 rebuilt it per request and paid for it).
 */
export function allCodes(length: number): readonly string[] {
  assertLength(length);
  let codes = codesByLength.get(length);
  if (!codes) {
    const result: string[] = [];
    const extend = (prefix: string): void => {
      if (prefix.length === length) {
        result.push(prefix);
        return;
      }
      for (const d of "0123456789") if (!prefix.includes(d)) extend(prefix + d);
    };
    extend("");
    codes = result;
    codesByLength.set(length, codes);
  }
  return codes;
}

/** How many codes still agree with every answer so far. The secret is always among them. */
export function remainingCount(
  length: number,
  attempts: readonly (Score & { guess: string })[],
): number {
  let count = 0;
  for (const code of allCodes(length)) {
    const fits = attempts.every((a) => {
      const s = score(code, a.guess);
      return s.bulls === a.bulls && s.cows === a.cows;
    });
    if (fits) count++;
  }
  return count;
}

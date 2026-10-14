/**
 * The guess being typed: a digit can go into any box. Convenience only — no game rules here,
 * the server checks every guess anyway.
 */

export interface Input {
  /** A digit or null per box; as many boxes as the game's number has digits. */
  readonly cells: readonly (string | null)[];
  /** The selected box; null once every box is filled. */
  readonly cursor: number | null;
}

export const emptyInput = (length: number): Input => ({
  cells: Array.from({ length }, () => null),
  cursor: 0,
});

export const usedDigits = (input: Input): ReadonlySet<string> =>
  new Set(input.cells.filter((cell) => cell !== null));

export const selectCell = (input: Input, index: number): Input => ({ ...input, cursor: index });

/** The next empty box to the right of `from`, wrapping around; null if none is empty. */
function nextEmpty(cells: readonly (string | null)[], from: number): number | null {
  for (let step = 1; step < cells.length; step++) {
    const index = (from + step) % cells.length;
    if (cells[index] === null) return index;
  }
  return null;
}

/**
 * Puts the digit into the selected box (replacing what was there) and moves on to the next
 * empty box. "full" means no box is selected: the player gets a hint.
 */
export function typeDigit(input: Input, digit: string): Input | "full" {
  if (input.cursor === null) return "full";
  if (usedDigits(input).has(digit)) return input;
  const cells = input.cells.map((cell, index) => (index === input.cursor ? digit : cell));
  return { cells, cursor: nextEmpty(cells, input.cursor) };
}

/**
 * ⌫: clears the selected box if it is filled; otherwise clears the nearest filled box to the
 * left and selects it. Nothing to the left — nothing happens.
 */
export function erase(input: Input): Input {
  const { cells, cursor } = input;
  let index = cursor ?? cells.length;
  if (cursor === null || cells[index] === null) {
    index--;
    while (index >= 0 && cells[index] === null) index--;
  }
  if (index < 0) return input;
  return { cells: cells.map((cell, i) => (i === index ? null : cell)), cursor: index };
}

/** The finished guess, or null while some box is empty. */
export const guessOf = (input: Input): string | null =>
  input.cells.every((cell) => cell !== null) ? input.cells.join("") : null;

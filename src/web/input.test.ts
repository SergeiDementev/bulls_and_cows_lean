import { describe, expect, it } from "vitest";
import {
  emptyInput,
  erase,
  guessOf,
  selectCell,
  typeDigit,
  usedDigits,
  type Input,
} from "./input.ts";

const input = (cells: string, cursor: number | null): Input => ({
  cells: [...cells].map((c) => (c === "_" ? null : c)),
  cursor,
});

describe("typing", () => {
  it("fills boxes left to right", () => {
    let state: Input | "full" = emptyInput(4);
    for (const d of "4601") state = typeDigit(state as Input, d);
    expect(state).toEqual(input("4601", null));
  });

  it("writes into the selected box and moves to the next empty one, wrapping around", () => {
    expect(typeDigit(input("__5_", 2), "7")).toEqual(input("__7_", 3));
    expect(typeDigit(input("1_5_", 3), "7")).toEqual(input("1_57", 1));
  });

  it("replaces a filled box; the old digit becomes free again", () => {
    const next = typeDigit(input("1234", 1), "9") as Input;
    expect(next).toEqual(input("1934", null));
    expect(usedDigits(next).has("2")).toBe(false);
  });

  it("ignores a digit already in the guess", () => {
    const state = input("12__", 2);
    expect(typeDigit(state, "1")).toBe(state);
  });

  it("reports full when no box is selected", () => {
    expect(typeDigit(input("1234", null), "5")).toBe("full");
  });

  it("selects any box", () => {
    expect(selectCell(input("12__", 2), 0)).toEqual(input("12__", 0));
  });
});

describe("erase", () => {
  it.each([
    ["clears the selected filled box", input("1234", 1), input("1_34", 1)],
    [
      "clears the nearest filled box to the left of an empty one",
      input("12__", 2),
      input("1___", 1),
    ],
    ["skips empty boxes on the way left", input("1___", 3), input("____", 0)],
    ["clears the last box when all are full", input("1234", null), input("123_", 3)],
  ])("%s", (_name, before, after) => {
    expect(erase(before)).toEqual(after);
  });

  it("does nothing with nothing to the left", () => {
    const state = input("_2__", 0);
    expect(erase(state)).toBe(state);
  });
});

describe("guessOf", () => {
  it("is ready only when every box is filled", () => {
    expect(guessOf(input("0123", null))).toBe("0123");
    expect(guessOf(input("01_3", 2))).toBeNull();
  });

  it("follows the game length", () => {
    expect(emptyInput(6).cells).toHaveLength(6);
  });
});

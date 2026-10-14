import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.ts";

describe("RateLimiter", () => {
  it("allows up to the limit within a window, then says how long to wait", () => {
    const limiter = new RateLimiter(60_000);
    expect([1, 2, 3].map(() => limiter.hit("a", 3, 0))).toEqual([0, 0, 0]);
    expect(limiter.hit("a", 3, 15_000)).toBe(45);
    expect(limiter.hit("a", 3, 59_001)).toBe(1);
  });

  it("starts a new window when the old one ends", () => {
    const limiter = new RateLimiter(60_000);
    limiter.hit("a", 1, 0);
    expect(limiter.hit("a", 1, 1)).toBeGreaterThan(0);
    expect(limiter.hit("a", 1, 60_000)).toBe(0);
  });

  it("counts keys separately", () => {
    const limiter = new RateLimiter(60_000);
    limiter.hit("a", 1, 0);
    expect(limiter.hit("b", 1, 0)).toBe(0);
  });

  it("forgets expired windows once it holds many keys", () => {
    const limiter = new RateLimiter(10);
    for (let i = 0; i <= 100_000; i++) limiter.hit(`k${i}`, 1, 0);
    // The next new key triggers the cleanup; old keys start fresh afterwards
    expect(limiter.hit("new", 1, 20)).toBe(0);
    expect(limiter.hit("k0", 1, 20)).toBe(0);
  });
});

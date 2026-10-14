import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("fills defaults", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://x", BOT_TOKEN: "t" })).toMatchObject({
      PORT: 3000,
      GAME_LENGTH: 4,
      INIT_DATA_MAX_AGE_SECONDS: 86_400,
      RATE_LIMIT_PER_PLAYER: 120,
      SLOW_REQUEST_MS: 200,
    });
  });

  it("lists every problem at once", () => {
    expect(() => loadConfig({ PORT: "abc", GAME_LENGTH: "7" })).toThrow(
      /DATABASE_URL[\s\S]*BOT_TOKEN[\s\S]*PORT[\s\S]*GAME_LENGTH/,
    );
  });
});

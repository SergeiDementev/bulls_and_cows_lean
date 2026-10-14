import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { createDb } from "./db.ts";
import { call, useServer } from "./test-helpers.ts";

const anna = { id: 111 };

describe("rate limits", () => {
  const ctx = useServer({ RATE_LIMIT_PER_PLAYER: "3", RATE_LIMIT_PER_IP_UNAUTHORIZED: "2" });

  it("limits a signed-in player per minute", async () => {
    for (let i = 0; i < 3; i++)
      expect((await call(ctx, "POST", "/api/session", { user: anna })).status).toBe(200);
    const limited = await call(ctx, "POST", "/api/session", { user: anna });
    expect(limited).toMatchObject({ status: 429, body: { error: { code: "rate.limited" } } });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);

    // Another player is not affected
    expect((await call(ctx, "POST", "/api/session", { user: { id: 222 } })).status).toBe(200);

    ctx.now += 60_000;
    expect((await call(ctx, "POST", "/api/session", { user: anna })).status).toBe(200);
  });

  it("limits requests without a valid signature per address", async () => {
    for (let i = 0; i < 2; i++) expect((await call(ctx, "POST", "/api/session")).status).toBe(401);
    expect((await call(ctx, "POST", "/api/session")).status).toBe(429);
  });
});

describe("observability", () => {
  const ctx = useServer({ SLOW_REQUEST_MS: "0" });

  it("logs slow requests with their database queries", async () => {
    await call(ctx, "POST", "/api/session", { user: anna });
    await call(ctx, "POST", "/api/games", { user: anna });
    const slow = ctx.logs.filter((l) => l.msg === "slow request");
    expect(slow).toContainEqual(
      expect.objectContaining({ url: "/api/session", dbQueries: 2, dbMs: expect.any(Number) }),
    );
    // player lookup, latest game, insert
    expect(slow).toContainEqual(expect.objectContaining({ url: "/api/games", dbQueries: 3 }));
  });

  it("answers 500 with no details and logs the failure", async () => {
    const broken = createDb("postgres://nobody:wrong@127.0.0.1:1/none", 1);
    const logs: Record<string, unknown>[] = [];
    const app = buildApp({
      db: broken,
      config: ctx.config,
      logStream: { write: (line) => void logs.push(JSON.parse(line)) },
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: { code: "internal.error" } });
    expect(logs).toContainEqual(expect.objectContaining({ msg: "unexpected error" }));
    await app.close();
    await broken.destroy();
  });
});

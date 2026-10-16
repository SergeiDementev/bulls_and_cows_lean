import { describe, expect, it } from "vitest";
import { allCodes } from "../domain/code.ts";
import { signInitData } from "./init-data.ts";
import { authHeader, BOT_TOKEN, call, secretOf, useServer, type TestUser } from "./test-helpers.ts";

const anna: TestUser = { id: 111, username: "anna_k", language_code: "ru" };
const bob: TestUser = { id: 222, language_code: "en-GB" };

describe("server", () => {
  const ctx = useServer();

  const open = (user: TestUser) => call(ctx, "POST", "/api/session", { user });
  const start = (user: TestUser) => call(ctx, "POST", "/api/games", { user });
  const move = (user: TestUser, gameId: number, attempt: number, guess: string) =>
    call(ctx, "POST", `/api/games/${gameId}/guesses`, { user, body: { guess, attempt } });
  const quit = (user: TestUser, gameId: number) =>
    call(ctx, "POST", `/api/games/${gameId}/abandon`, { user });
  const wrongGuess = async (gameId: number) => {
    const secret = await secretOf(ctx.db, gameId);
    return allCodes(4).find((c) => c !== secret)!;
  };

  describe("session", () => {
    it("registers a player with the language from Telegram", async () => {
      const res = await open(anna);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        player: { id: 1, username: "anna_k", language: "ru" },
        game: null,
        gameLength: 4,
      });
    });

    it.each([
      ["ru-RU", "ru"],
      ["RU", "ru"],
      ["en-GB", "en"],
      ["de", "en"],
      [undefined, "en"],
    ])("maps language %s to %s", async (code, language) => {
      const user = code ? { id: 5, language_code: code } : { id: 5 };
      expect((await open(user)).body.player.language).toBe(language);
    });

    it("keeps the chosen language and refreshes the username on the next visit", async () => {
      await open(anna);
      await call(ctx, "PATCH", "/api/me", { user: anna, body: { language: "en" } });
      const res = await open({ ...anna, username: "anna_new", language_code: "ru" });
      expect(res.body.player).toEqual({ id: 1, username: "anna_new", language: "en" });
    });

    it("returns the latest game with its moves", async () => {
      await open(anna);
      const game = (await start(anna)).body;
      const guess = await wrongGuess(game.id);
      await move(anna, game.id, 1, guess);
      const res = await open(anna);
      expect(res.body.game).toMatchObject({
        id: game.id,
        status: "active",
        attempts: [{ number: 1, guess }],
      });
    });
  });

  describe("sign-in", () => {
    it.each([
      ["no header", {}],
      ["another scheme", { authorization: "Bearer abc" }],
      ["garbage", { authorization: "tma not-init-data" }],
    ])("rejects %s", async (_name, headers) => {
      const res = await call(ctx, "POST", "/api/session", { headers });
      expect(res).toMatchObject({ status: 401, body: { error: { code: "auth.unauthorized" } } });
    });

    it("rejects data signed with another bot token", async () => {
      const forged = signInitData(anna, "other-token", Math.floor(ctx.now / 1000));
      const res = await call(ctx, "POST", "/api/session", {
        headers: { authorization: `tma ${forged}` },
      });
      expect(res.body.error.code).toBe("auth.unauthorized");
    });

    it("rejects a player swapped inside signed data", async () => {
      const signed = new URLSearchParams(signInitData(anna, BOT_TOKEN, Math.floor(ctx.now / 1000)));
      signed.set("user", JSON.stringify(bob));
      const res = await call(ctx, "POST", "/api/session", {
        headers: { authorization: `tma ${signed}` },
      });
      expect(res.body.error.code).toBe("auth.unauthorized");
    });

    it("reports expired data once the signature is valid", async () => {
      const dayAgo = Math.floor(ctx.now / 1000) - 24 * 60 * 60 - 1;
      const res = await call(ctx, "POST", "/api/session", {
        headers: { authorization: authHeader(anna, dayAgo) },
      });
      expect(res).toMatchObject({
        status: 401,
        body: { error: { code: "auth.init_data_expired" } },
      });
    });

    it("checks the signature before saying a route does not exist", async () => {
      expect((await call(ctx, "GET", "/api/nothing")).status).toBe(401);
      const res = await call(ctx, "GET", "/api/nothing", { user: anna });
      expect(res).toMatchObject({ status: 404, body: { error: { code: "route.not_found" } } });
    });

    it("never writes initData to the log", async () => {
      await open(anna);
      await call(ctx, "POST", "/api/session", { headers: { authorization: "tma hash=leak-me" } });
      expect(JSON.stringify(ctx.logs)).not.toMatch(/hash=|auth_date|anna_k/);
    });
  });

  it("asks to register when the player is unknown", async () => {
    const res = await start(anna);
    expect(res).toMatchObject({ status: 404, body: { error: { code: "player.not_found" } } });
  });

  describe("game", () => {
    it("plays to a win and reveals the secret only then", async () => {
      await open(anna);
      const started = await start(anna);
      expect(started).toMatchObject({
        status: 201,
        body: { status: "active", length: 4, attempts: [], remaining: null, secret: null },
      });

      const id = started.body.id;
      const miss = await move(anna, id, 1, await wrongGuess(id));
      expect(miss.body).toMatchObject({ status: "active", secret: null });
      expect(miss.body.remaining).toBeGreaterThanOrEqual(1);

      const secret = await secretOf(ctx.db, id);
      const win = await move(anna, id, 2, secret);
      expect(win.body).toMatchObject({ status: "won", secret, remaining: 1 });
      expect(win.body.attempts.at(-1)).toEqual({ number: 2, guess: secret, bulls: 4, cows: 0 });
    });

    it("refuses a second game while one is active", async () => {
      await open(anna);
      await start(anna);
      expect((await start(anna)).body.error.code).toBe("game.already_active");
    });

    it("starts a new game after the previous one ended", async () => {
      await open(anna);
      const first = (await start(anna)).body;
      await quit(anna, first.id);
      expect((await start(anna)).status).toBe(201);
    });

    it.each([
      ["12a4", "guess.invalid_format"],
      ["123", "guess.wrong_length"],
      ["1124", "guess.digits_not_unique"],
    ])("refuses guess %j with %s and does not count it", async (guess, code) => {
      await open(anna);
      const id = (await start(anna)).body.id;
      expect(await move(anna, id, 1, guess)).toMatchObject({
        status: 400,
        body: { error: { code } },
      });
      expect((await open(anna)).body.game.attempts).toEqual([]);
    });

    it("refuses a repeated attempt number", async () => {
      await open(anna);
      const id = (await start(anna)).body.id;
      const guess = await wrongGuess(id);
      await move(anna, id, 1, guess);
      const again = await move(anna, id, 1, guess);
      expect(again).toMatchObject({
        status: 409,
        body: { error: { code: "guess.attempt_mismatch" } },
      });
    });

    it("counts only one of two identical moves sent at once", async () => {
      await open(anna);
      const id = (await start(anna)).body.id;
      const guess = await wrongGuess(id);
      const results = await Promise.all([move(anna, id, 1, guess), move(anna, id, 1, guess)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await open(anna)).body.game.attempts).toHaveLength(1);
    });

    it("starts only one of two games requested at once", async () => {
      await open(anna);
      const results = await Promise.all([start(anna), start(anna)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it("abandons a game and reveals the secret", async () => {
      await open(anna);
      const id = (await start(anna)).body.id;
      const res = await quit(anna, id);
      expect(res.body).toMatchObject({ status: "abandoned", secret: await secretOf(ctx.db, id) });
    });

    it.each(["won", "abandoned"])("refuses moves and abandoning in a %s game", async (end) => {
      await open(anna);
      const id = (await start(anna)).body.id;
      if (end === "won") await move(anna, id, 1, await secretOf(ctx.db, id));
      else await quit(anna, id);
      expect((await move(anna, id, 2, "0123")).body.error.code).toBe("game.not_active");
      expect((await quit(anna, id)).body.error.code).toBe("game.not_active");
    });

    it("hides someone else's game", async () => {
      await open(anna);
      await open(bob);
      const id = (await start(anna)).body.id;
      expect((await move(bob, id, 1, "0123")).body.error.code).toBe("game.not_found");
      expect((await quit(bob, id)).body.error.code).toBe("game.not_found");
      expect((await move(anna, 999, 1, "0123")).body.error.code).toBe("game.not_found");
    });
  });

  describe("request shape", () => {
    it.each([
      ["missing attempt", { guess: "0123" }],
      ["number instead of string", { guess: 123, attempt: 1 }],
      ["extra field", { guess: "0123", attempt: 1, cheat: true }],
    ])("refuses a guess with %s", async (_name, body) => {
      await open(anna);
      const id = (await start(anna)).body.id;
      const res = await call(ctx, "POST", `/api/games/${id}/guesses`, { user: anna, body });
      expect(res).toMatchObject({ status: 400, body: { error: { code: "request.invalid" } } });
    });

    it("refuses a bad game id", async () => {
      await open(anna);
      const res = await call(ctx, "POST", "/api/games/abc/abandon", { user: anna });
      expect(res.body.error.code).toBe("request.invalid");
    });

    it("refuses malformed JSON", async () => {
      await open(anna);
      const res = await call(ctx, "PATCH", "/api/me", {
        user: anna,
        body: "{not json",
        headers: { "content-type": "application/json" },
      });
      expect(res).toMatchObject({ status: 400, body: { error: { code: "request.invalid" } } });
    });

    it("ignores the content type of an empty body", async () => {
      const headers = { "content-type": "application/x-www-form-urlencoded" };
      expect((await call(ctx, "POST", "/api/session", { user: anna, headers })).status).toBe(200);
    });

    it("refuses a guess that is not JSON", async () => {
      await open(anna);
      const id = (await start(anna)).body.id;
      const res = await call(ctx, "POST", `/api/games/${id}/guesses`, {
        user: anna,
        body: "guess=0123&attempt=1",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(res.body.error.code).toBe("request.invalid");
    });

    it("refuses an unsupported language", async () => {
      await open(anna);
      const res = await call(ctx, "PATCH", "/api/me", { user: anna, body: { language: "de" } });
      expect(res.body.error.code).toBe("request.invalid");
    });
  });

  describe("client errors", () => {
    it("are written to the log", async () => {
      await open(anna);
      const report = { message: "boom", stack: "at x", screen: "game" };
      expect((await call(ctx, "POST", "/api/errors", { user: anna, body: report })).status).toBe(
        202,
      );
      expect(ctx.logs).toContainEqual(
        expect.objectContaining({ msg: "client error", clientError: report }),
      );
    });

    it("are limited in size", async () => {
      const res = await call(ctx, "POST", "/api/errors", {
        user: anna,
        body: { message: "x".repeat(2001) },
      });
      expect(res.body.error.code).toBe("request.invalid");
    });
  });

  it("answers health checks without sign-in", async () => {
    expect(await call(ctx, "GET", "/health")).toMatchObject({
      status: 200,
      body: { status: "ok" },
    });
  });
});

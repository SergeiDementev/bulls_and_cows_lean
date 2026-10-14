import { describe, expect, it, vi } from "vitest";
import { setupBot } from "./bot.ts";
import { call, useServer } from "./test-helpers.ts";

const SECRET = "s".repeat(40);
const URL = "https://game.example";

const start = (from: { id: number; language_code?: string }, text = "/start") => ({
  update_id: 1,
  message: { chat: { id: from.id }, from, text },
});

describe("bot webhook", () => {
  const ctx = useServer({ WEBAPP_URL: URL, WEBHOOK_SECRET: SECRET });
  const hook = (body: unknown, secret = SECRET) =>
    call(ctx, "POST", "/telegram/webhook", {
      body,
      headers: { "x-telegram-bot-api-secret-token": secret },
    });

  it("answers /start with the rules and a Play button", async () => {
    const res = await hook(start({ id: 5, language_code: "ru" }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      method: "sendMessage",
      chat_id: 5,
      text: expect.stringMatching(
        /^🐂🐄 Быки и коровы\n\nЯ загадываю число из 4 разных цифр[\s\S]*\n🐄 корова/,
      ),
      reply_markup: { inline_keyboard: [[{ text: "Играть", web_app: { url: URL } }]] },
    });
  });

  it("speaks the language a known player chose, not the Telegram one", async () => {
    const user = { id: 6, language_code: "ru" };
    await call(ctx, "POST", "/api/session", { user });
    await call(ctx, "PATCH", "/api/me", { user, body: { language: "en" } });
    const res = await hook(start(user));
    expect(res.body.reply_markup.inline_keyboard[0][0].text).toBe("Play");
  });

  it("stays silent on anything but /start", async () => {
    const res = await hook(start({ id: 5 }, "hello"));
    expect(res).toMatchObject({ status: 200, body: undefined });
    expect((await hook({ update_id: 2 })).body).toBeUndefined();
  });

  it.each([
    ["wrong", "x".repeat(40)],
    ["missing", ""],
  ])("refuses a %s secret", async (_n, secret) => {
    const res = await hook(start({ id: 5 }), secret);
    expect(res).toMatchObject({ status: 401, body: { error: { code: "auth.unauthorized" } } });
  });
});

describe("bot webhook without settings", () => {
  const ctx = useServer();

  it("does not exist", async () => {
    expect((await call(ctx, "POST", "/telegram/webhook", { body: {} })).status).toBe(404);
  });
});

describe("bot setup", () => {
  it("sets the webhook, both descriptions and clears the commands, without echoing the token", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true })));
    const results = await setupBot(
      { BOT_TOKEN: "123:abc", WEBAPP_URL: URL, WEBHOOK_SECRET: SECRET, GAME_LENGTH: 4 },
      fetchFn,
    );
    const calls = fetchFn.mock.calls.map(([url, init]) => [
      String(url).replace("https://api.telegram.org/bot123:abc/", ""),
      JSON.parse(String(init?.body)),
    ]);
    expect(calls).toEqual([
      [
        "setWebhook",
        {
          url: `${URL}/telegram/webhook`,
          secret_token: SECRET,
          allowed_updates: ["message"],
          drop_pending_updates: true,
        },
      ],
      ["setMyDescription", { description: expect.stringMatching(/^Bulls & Cows.*4-digit/) }],
      [
        "setMyDescription",
        { description: expect.stringMatching(/^Логическая.*из 4 разных/), language_code: "ru" },
      ],
      ["deleteMyCommands", {}],
      ["deleteMyCommands", { language_code: "ru" }],
      ["deleteMyCommands", { language_code: "en" }],
    ]);
    expect(JSON.stringify(results)).not.toContain("abc");
  });
});

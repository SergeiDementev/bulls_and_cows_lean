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
  const calls = (method: string) => ctx.telegram.calls.filter((c) => c.method === method);
  const button = (text: string) => ({ inline_keyboard: [[{ text, web_app: { url: URL } }]] });

  it("greets /start with the rules and a Play button, and labels the menu button", async () => {
    const res = await hook(start({ id: 5, language_code: "ru" }));
    expect(res).toMatchObject({ status: 200, body: undefined });
    expect(calls("sendMessage")).toEqual([
      {
        method: "sendMessage",
        params: {
          chat_id: 5,
          text: expect.stringMatching(
            /^🐂🐄 Быки и коровы\n\nЯ загадываю число из 4 разных цифр[\s\S]*\n🐄 корова/,
          ),
          reply_markup: button("Играть"),
        },
      },
    ]);
    expect(calls("setChatMenuButton")[0]?.params).toEqual({
      chat_id: 5,
      menu_button: { type: "web_app", text: "Играть", web_app: { url: URL } },
    });
  });

  it("speaks the language a known player chose, not the Telegram one", async () => {
    const user = { id: 6, language_code: "ru" };
    await call(ctx, "POST", "/api/session", { user });
    await call(ctx, "PATCH", "/api/me", { user, body: { language: "en" } });
    await hook(start(user));
    expect(calls("sendMessage")[0]?.params.reply_markup).toEqual(button("Play"));
  });

  it("removes the previous greeting once the new one is sent", async () => {
    await hook(start({ id: 5 }));
    await hook(start({ id: 5 }));
    expect(calls("deleteMessage").map((c) => c.params)).toEqual([
      { chat_id: "5", message_id: 101 },
    ]);
  });

  it("keeps the previous greeting if the new one could not be sent", async () => {
    await hook(start({ id: 5 }));
    ctx.telegram.failing.add("sendMessage");
    const res = await hook(start({ id: 5 }));
    // Still 200: Telegram would otherwise resend the update again and again
    expect(res.status).toBe(200);
    expect(calls("deleteMessage")).toEqual([]);
    expect(ctx.logs).toContainEqual(
      expect.objectContaining({ msg: "telegram call failed", action: "send greeting" }),
    );
  });

  it("stays silent on anything but /start", async () => {
    await hook(start({ id: 5 }, "hello"));
    await hook({ update_id: 2 });
    expect(ctx.telegram.calls).toEqual([]);
  });

  it.each([
    ["wrong", "x".repeat(40)],
    ["missing", ""],
  ])("refuses a %s secret", async (_n, secret) => {
    const res = await hook(start({ id: 5 }), secret);
    expect(res).toMatchObject({ status: 401, body: { error: { code: "auth.unauthorized" } } });
    expect(ctx.telegram.calls).toEqual([]);
  });

  describe("language switch in the Mini App", () => {
    const user = { id: 7, language_code: "ru" };

    it("rewrites the greeting and the menu button in the chat", async () => {
      await call(ctx, "POST", "/api/session", { user });
      await hook(start(user));
      ctx.telegram.calls = [];

      const res = await call(ctx, "PATCH", "/api/me", { user, body: { language: "en" } });
      expect(res.status).toBe(200);
      expect(ctx.telegram.calls).toEqual([
        {
          method: "editMessageText",
          params: {
            chat_id: "7",
            message_id: 101,
            text: expect.stringMatching(/^🐂🐄 Bulls & Cows\n\nI'm thinking of a 4-digit number/),
            reply_markup: button("Play"),
          },
        },
        {
          method: "setChatMenuButton",
          params: {
            chat_id: "7",
            menu_button: { type: "web_app", text: "Play", web_app: { url: URL } },
          },
        },
      ]);
    });

    it("touches nothing in a chat without a greeting", async () => {
      await call(ctx, "POST", "/api/session", { user });
      await call(ctx, "PATCH", "/api/me", { user, body: { language: "en" } });
      expect(ctx.telegram.calls).toEqual([]);
    });

    it("still switches the language when Telegram refuses", async () => {
      await call(ctx, "POST", "/api/session", { user });
      await hook(start(user));
      ctx.telegram.failing.add("editMessageText");
      const res = await call(ctx, "PATCH", "/api/me", { user, body: { language: "en" } });
      expect(res).toMatchObject({ status: 200, body: { player: { language: "en" } } });
      expect(ctx.logs).toContainEqual(
        expect.objectContaining({ msg: "telegram call failed", action: "rewrite greeting" }),
      );
    });
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

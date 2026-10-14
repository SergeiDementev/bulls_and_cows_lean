import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signInitData, verifyInitData } from "./init-data.ts";

const TOKEN = "123456:test-token";
const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;
const user = { id: 42, username: "anna_k", language_code: "ru" };

const verify = (initData: string, now = NOW) => verifyInitData(initData, TOKEN, DAY, now);

describe("verifyInitData", () => {
  it("accepts data signed with the bot token", () => {
    expect(verify(signInitData(user, TOKEN, NOW))).toEqual({
      ok: true,
      user: { id: 42, username: "anna_k", languageCode: "ru" },
    });
  });

  it("matches a hash computed independently, step by step from the Telegram docs", () => {
    const userJson = JSON.stringify({ id: 7 });
    const dataCheckString = `auth_date=${NOW}\nquery_id=abc\nuser=${userJson}`;
    const secretKey = createHmac("sha256", "WebAppData").update(TOKEN).digest();
    const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const initData = new URLSearchParams({
      user: userJson,
      query_id: "abc",
      auth_date: String(NOW),
      hash,
    });
    expect(verify(initData.toString())).toEqual({
      ok: true,
      user: { id: 7, username: null, languageCode: null },
    });
  });

  it.each([
    ["empty string", ""],
    ["no hash", "auth_date=1&user=%7B%22id%22%3A1%7D"],
    ["short hash", `${signInitData(user, TOKEN, NOW)}`.replace(/hash=[0-9a-f]+/, "hash=abc")],
    ["another token", signInitData(user, "other", NOW)],
  ])("rejects %s", (_name, initData) => {
    expect(verify(initData)).toEqual({ ok: false, error: "auth.unauthorized" });
  });

  it.each([
    ["user", JSON.stringify({ id: 43 })],
    ["auth_date", String(NOW + 100)],
    ["query_id", "other"],
  ])("rejects a changed %s", (field, value) => {
    const fields = new URLSearchParams(signInitData(user, TOKEN, NOW));
    fields.set(field, value);
    expect(verify(fields.toString())).toEqual({ ok: false, error: "auth.unauthorized" });
  });

  it("rejects an added field", () => {
    expect(verify(`${signInitData(user, TOKEN, NOW)}&extra=1`).ok).toBe(false);
  });

  it.each([
    ["not JSON", "{oops"],
    ["no id", JSON.stringify({ username: "x" })],
    ["id as text", JSON.stringify({ id: "42" })],
  ])("rejects a signed user that is %s", (_name, userField) => {
    const fields = new URLSearchParams({ auth_date: String(NOW), user: userField });
    const signed = signRaw(fields);
    expect(verify(signed)).toEqual({ ok: false, error: "auth.unauthorized" });
  });

  it("rejects a signed auth_date that is not a number", () => {
    const fields = new URLSearchParams({ auth_date: "yesterday", user: JSON.stringify({ id: 1 }) });
    expect(verify(signRaw(fields))).toEqual({ ok: false, error: "auth.unauthorized" });
  });

  it("accepts data exactly 24 hours old and rejects older as expired", () => {
    const initData = signInitData(user, TOKEN, NOW);
    expect(verify(initData, NOW + DAY).ok).toBe(true);
    expect(verify(initData, NOW + DAY + 1)).toEqual({ ok: false, error: "auth.init_data_expired" });
  });

  it("says unauthorized, not expired, when old data has a bad signature", () => {
    expect(verify(signInitData(user, "other", NOW), NOW + 2 * DAY).ok).toBe(false);
    expect(verify(signInitData(user, "other", NOW), NOW + 2 * DAY)).toEqual({
      ok: false,
      error: "auth.unauthorized",
    });
  });
});

/** Signs arbitrary fields, to reach the checks that run after the signature. */
function signRaw(fields: URLSearchParams): string {
  const dataCheckString = [...fields]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  fields.set("hash", createHmac("sha256", secretKey).update(dataCheckString).digest("hex"));
  return fields.toString();
}

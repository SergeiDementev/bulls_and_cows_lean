/** Telegram Mini App initData: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export interface TelegramUser {
  id: number;
  username: string | null;
  languageCode: string | null;
}

export type InitDataResult =
  | { ok: true; user: TelegramUser }
  | { ok: false; error: "auth.unauthorized" | "auth.init_data_expired" };

const userSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(35).optional(),
});

/** Every field except hash, sorted by key, as key=value lines. */
function hashOf(fields: URLSearchParams, botToken: string): string {
  const dataCheckString = [...fields]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  return createHmac("sha256", secretKeyOf(botToken)).update(dataCheckString).digest("hex");
}

// Derived from the token once instead of on every request: the load test showed it in the profile
const secretKeys = new Map<string, Buffer>();
function secretKeyOf(botToken: string): Buffer {
  let key = secretKeys.get(botToken);
  if (!key) {
    key = createHmac("sha256", "WebAppData").update(botToken).digest();
    secretKeys.set(botToken, key);
  }
  return key;
}

export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  nowSeconds: number,
): InitDataResult {
  const fields = new URLSearchParams(initData);
  const hash = fields.get("hash") ?? "";
  const expected = hashOf(fields, botToken);
  if (
    hash.length !== expected.length ||
    !timingSafeEqual(Buffer.from(hash), Buffer.from(expected))
  ) {
    return { ok: false, error: "auth.unauthorized" };
  }

  let user: z.infer<typeof userSchema>;
  try {
    user = userSchema.parse(JSON.parse(fields.get("user") ?? ""));
  } catch {
    return { ok: false, error: "auth.unauthorized" };
  }

  // Reported only after the signature checks out: a forger learns nothing from it
  const authDate = Number(fields.get("auth_date"));
  if (!Number.isInteger(authDate)) return { ok: false, error: "auth.unauthorized" };
  if (nowSeconds - authDate > maxAgeSeconds) return { ok: false, error: "auth.init_data_expired" };

  return {
    ok: true,
    user: {
      id: user.id,
      username: user.username ?? null,
      languageCode: user.language_code ?? null,
    },
  };
}

/** Signs initData the way Telegram does. For tests and the local dev script only. */
export function signInitData(
  user: { id: number; username?: string; language_code?: string },
  botToken: string,
  authDateSeconds: number,
): string {
  const fields = new URLSearchParams({
    auth_date: String(authDateSeconds),
    query_id: "dev",
    user: JSON.stringify(user),
  });
  fields.set("hash", hashOf(fields, botToken));
  return fields.toString();
}

/** Requests to the server. Every request carries the initData Telegram signed for this player. */
import type {
  ErrorBody,
  ErrorCode,
  GameView,
  Language,
  PlayerView,
  SessionView,
  StatsView,
} from "../shared/api.ts";

/** The server refused with a code. Anything else thrown here means no connection. */
export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface ClientErrorReport {
  message: string;
  stack?: string;
  screen?: string;
}

export function createApi(initData: string, fetchFn: typeof fetch = (...a) => fetch(...a)) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetchFn(path, {
      method,
      headers: {
        Authorization: `tma ${initData}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      throw new ApiError((data as ErrorBody | undefined)?.error.code ?? "internal.error");
    }
    return data as T;
  }

  return {
    session: () => request<SessionView>("POST", "/api/session"),
    setLanguage: (language: Language) =>
      request<{ player: PlayerView }>("PATCH", "/api/me", { language }),
    newGame: () => request<GameView>("POST", "/api/games"),
    guess: (gameId: number, guess: string, attempt: number) =>
      request<GameView>("POST", `/api/games/${gameId}/guesses`, { guess, attempt }),
    abandon: (gameId: number) => request<GameView>("POST", `/api/games/${gameId}/abandon`),
    stats: () => request<StatsView>("GET", "/api/stats"),
    reportError: (report: ClientErrorReport) => request<void>("POST", "/api/errors", report),
  };
}

export type Api = ReturnType<typeof createApi>;

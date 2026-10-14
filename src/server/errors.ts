import type { ErrorCode } from "../shared/api.ts";

// A Record over the full union: adding an error code without its status fails to compile
export const STATUS: Record<ErrorCode, number> = {
  "request.invalid": 400,
  "guess.invalid_format": 400,
  "guess.wrong_length": 400,
  "guess.digits_not_unique": 400,
  "auth.unauthorized": 401,
  "auth.init_data_expired": 401,
  "route.not_found": 404,
  "player.not_found": 404,
  "game.not_found": 404,
  "game.not_active": 409,
  "game.already_active": 409,
  "guess.attempt_mismatch": 409,
  "rate.limited": 429,
  "internal.error": 500,
};

/** An expected refusal: the client gets the code, the log does not treat it as a failure. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, details?: unknown) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

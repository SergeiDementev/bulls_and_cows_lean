/** Unexpected errors in the page go to the server log. API refusals and lost connections do not. */
import type { ClientErrorReport } from "./api.ts";

/** A broken page must not flood the log. */
export const MAX_REPORTS = 5;

export interface Reporter {
  setScreen(screen: string): void;
  report(error: unknown): void;
}

export function createReporter(send: (report: ClientErrorReport) => Promise<unknown>): Reporter {
  let screen = "loading";
  let sent = 0;
  return {
    setScreen: (name) => {
      screen = name;
    },
    report: (error) => {
      if (sent >= MAX_REPORTS) return;
      sent++;
      const failure = error instanceof Error ? error : new Error(String(error));
      send({
        message: (failure.message || failure.name).slice(0, 2000),
        ...(failure.stack && { stack: failure.stack.slice(0, 10_000) }),
        screen,
      }).catch(() => undefined); // the player never notices a lost report
    },
  };
}

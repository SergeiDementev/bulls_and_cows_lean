/**
 * Mini App state and the player's actions. Components only draw the state and call actions.
 *
 * Failures: no connection → "Try again" and the typed digits stay; the game moved on elsewhere
 * (409) → quietly reload it from the server; initData expired → ask to reopen the Mini App.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  LANGUAGES,
  type ErrorCode,
  type GameView,
  type Language,
  type StatsView,
} from "../shared/api.ts";
import type { TextArgs } from "../shared/i18n.ts";
import { ApiError, type Api } from "./api.ts";
import { emptyInput, erase, guessOf, selectCell, typeDigit, type Input } from "./input.ts";

export type View =
  | { kind: "loading" }
  /** `result` is the game that has just ended; `celebrate` — it was just won here. */
  | { kind: "title"; result: GameView | null; celebrate: boolean }
  | { kind: "game" }
  | { kind: "confirm" }
  | { kind: "expired" }
  /** `back` — the title screen it was opened from, with or without a game result. */
  | { kind: "stats"; stats: StatsView; back: TitleView };

type TitleView = Extract<View, { kind: "title" }>;

/** `id` restarts the timer when the same toast is shown twice in a row. */
export interface Toast {
  key: string;
  args?: TextArgs;
  id: number;
}

export interface GameState {
  view: View;
  language: Language;
  /** Our player id: their own row is highlighted in the rating. */
  playerId: number | null;
  /** The current or latest game; null before the first one. */
  game: GameView | null;
  input: Input;
  /** A request is running: buttons wait, so a move is never sent twice. */
  busy: boolean;
  offline: boolean;
  toast: Toast | null;
}

/** "The game is not what the screen shows": not an error for the player, just reload it. */
const OUT_OF_SYNC: readonly ErrorCode[] = [
  "guess.attempt_mismatch",
  "game.not_active",
  "game.already_active",
  "game.not_found",
  "player.not_found",
];

/** Until a game exists. After that the length always comes from the game. */
const DEFAULT_LENGTH = 4;

const title = (result: GameView | null = null, celebrate = false): TitleView => ({
  kind: "title",
  result,
  celebrate,
});

export function useGame(api: Api, initialLanguage: Language) {
  const [state, setState] = useState<GameState>({
    view: { kind: "loading" },
    language: initialLanguage,
    playerId: null,
    game: null,
    input: emptyInput(DEFAULT_LENGTH),
    busy: true,
    offline: false,
    toast: null,
  });

  // Actions that wait for the server read the state as it is when the answer arrives
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  });
  const retryAction = useRef<(() => Promise<void>) | null>(null);

  const patch = useCallback(
    (change: Partial<GameState> | ((s: GameState) => Partial<GameState>)) => {
      setState((s) => ({ ...s, ...(typeof change === "function" ? change(s) : change) }));
    },
    [],
  );

  const showToast = useCallback(
    (key: string, args?: TextArgs) =>
      patch({ toast: { key, ...(args && { args }), id: Date.now() } }),
    [patch],
  );

  /** Player and latest game from the server: on opening, on return, after a 409. */
  const sync = useCallback(async () => {
    const { player, game } = await api.session();
    patch((s) => {
      // The same game keeps its typed digits; another one starts empty
      const input =
        game && game.id === s.game?.id ? s.input : emptyInput(game?.length ?? DEFAULT_LENGTH);
      const playing = s.view.kind === "game" || s.view.kind === "confirm";
      let view = s.view.kind === "loading" ? title() : s.view;
      // The game being played was finished elsewhere: show its result
      if (playing && game?.status !== "active") view = title(game);
      return { language: player.language, playerId: player.id, game, input, view };
    });
  }, [api, patch]);

  /** Runs a request with the shared failure handling; changes state only after the answer. */
  const execute = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
        retryAction.current = null;
        patch({ offline: false });
      } catch (error) {
        if (!(error instanceof ApiError)) {
          retryAction.current = action;
          patch({ offline: true });
        } else if (error.code === "auth.init_data_expired") {
          patch({ view: { kind: "expired" } });
        } else if (OUT_OF_SYNC.includes(error.code)) {
          try {
            await sync();
          } catch {
            retryAction.current = sync;
            patch({ offline: true });
          }
        } else {
          showToast(
            error.code === "rate.limited" ? "error-service-unavailable" : "error-unexpected",
          );
        }
      } finally {
        patch({ busy: false });
      }
    },
    [patch, showToast, sync],
  );

  const run = useCallback(
    (action: () => Promise<void>) => {
      patch({ busy: true });
      void execute(action);
    },
    [execute, patch],
  );

  useEffect(() => {
    // execute changes state only after awaiting the server, never synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void execute(sync);
  }, [execute, sync]);

  // Back in the Mini App: the game may have moved on in another window or device
  useEffect(() => {
    const onVisible = () => {
      const { view } = latest.current;
      if (
        document.visibilityState === "visible" &&
        view.kind !== "loading" &&
        view.kind !== "expired"
      )
        run(sync);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [run, sync]);

  const actions = {
    newGame: () =>
      run(async () => {
        const game = await api.newGame();
        patch({ game, input: emptyInput(game.length), view: { kind: "game" } });
      }),

    continueGame: () => patch({ view: { kind: "game" } }),

    selectCell: (index: number) => patch((s) => ({ input: selectCell(s.input, index) })),

    // Computed from the previous state: two quick taps never lose a digit
    digit: (digit: string) =>
      patch((s) => {
        const next = typeDigit(s.input, digit);
        if (next !== "full") return { input: next };
        return {
          toast: {
            key: "toast-input-full",
            args: { length: s.input.cells.length },
            id: Date.now(),
          },
        };
      }),

    erase: () => patch((s) => ({ input: erase(s.input) })),

    check: () => {
      const { input, game } = latest.current;
      if (!game) return;
      const guess = guessOf(input);
      if (guess === null) {
        showToast("toast-need-more-digits", { length: game.length });
        return;
      }
      run(async () => {
        const next = await api.guess(game.id, guess, game.attempts.length + 1);
        const input = emptyInput(next.length);
        // A move ends a game only by winning
        patch(
          next.status === "active"
            ? { game: next, input }
            : { game: next, input, view: title(next, true) },
        );
      });
    },

    askAbandon: () => patch({ view: { kind: "confirm" } }),
    cancelAbandon: () => patch({ view: { kind: "game" } }),

    confirmAbandon: () => {
      const { game } = latest.current;
      if (!game) return;
      run(async () => {
        const next = await api.abandon(game.id);
        patch({ game: next, view: title(next) });
      });
    },

    openStats: () => {
      const { view } = latest.current;
      if (view.kind !== "title") return;
      run(async () => {
        const stats = await api.stats();
        // Coming back must not replay the win animation
        patch({ view: { kind: "stats", stats, back: { ...view, celebrate: false } } });
      });
    },

    closeStats: () => patch((s) => (s.view.kind === "stats" ? { view: s.view.back } : {})),

    // Stored on the server: the bot answers in the same language
    switchLanguage: () => {
      const { language } = latest.current;
      const next = LANGUAGES[(LANGUAGES.indexOf(language) + 1) % LANGUAGES.length]!;
      run(async () => {
        const { player } = await api.setLanguage(next);
        patch({ language: player.language });
      });
    },

    retry: () => {
      const action = retryAction.current;
      if (action) run(action);
    },

    hideToast: () => patch({ toast: null }),
  };

  return [state, actions] as const;
}

export type GameActions = ReturnType<typeof useGame>[1];

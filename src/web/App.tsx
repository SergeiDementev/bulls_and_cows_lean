/** Which screen to show for the current state. */
import { useEffect } from "react";
import type { GameView, Language } from "../shared/api.ts";
import type { Api } from "./api.ts";
import {
  ErrorBoundary,
  Header,
  History,
  Keypad,
  MessageScreen,
  OfflineBar,
  Slots,
  Toast,
} from "./components.tsx";
import { translations, type Translate } from "./i18n.ts";
import { usedDigits } from "./input.ts";
import type { Reporter } from "./report.ts";
import { useGame, type GameActions, type GameState } from "./use-game.ts";

interface AppProps {
  api: Api;
  initialLanguage: Language;
  reporter: Reporter;
  onClose(): void;
  onReload(): void;
}

export function App({ api, initialLanguage, reporter, onClose, onReload }: AppProps) {
  const [state, actions] = useGame(api, initialLanguage);
  const t = translations(state.language);
  const { view } = state;

  useEffect(() => reporter.setScreen(view.kind), [reporter, view.kind]);
  // Screen readers pick the pronunciation from the page language
  useEffect(() => {
    document.documentElement.lang = state.language;
  }, [state.language]);

  let screen;
  if (view.kind === "expired") {
    screen = (
      <MessageScreen text={t("session-expired")} label={t("button-close")} onClick={onClose} />
    );
  } else if (view.kind === "title") {
    screen = (
      <TitleScreen
        t={t}
        state={state}
        result={view.result}
        celebrate={view.celebrate}
        actions={actions}
      />
    );
  } else if (view.kind === "game" && state.game) {
    screen = <GameScreen t={t} state={state} game={state.game} actions={actions} />;
  } else if (view.kind === "confirm" && state.game) {
    screen = <ConfirmScreen t={t} state={state} game={state.game} actions={actions} />;
  } else {
    // Nothing to show until the server answers
    screen = <main className="screen" aria-busy="true" />;
  }

  return (
    <>
      <ErrorBoundary t={t} onError={reporter.report} onRetry={onReload}>
        {screen}
      </ErrorBoundary>
      {state.offline && <OfflineBar t={t} busy={state.busy} onRetry={actions.retry} />}
      <Toast t={t} toast={state.toast} onDone={actions.hideToast} />
    </>
  );
}

interface ScreenProps {
  t: Translate;
  state: GameState;
  actions: GameActions;
}

function resultText(t: Translate, game: GameView): string {
  const secret = game.secret ?? "";
  return game.status === "won"
    ? t("game-won", { secret, attempts: game.attempts.length })
    : t("game-abandoned", { secret });
}

/** Header and menu; after a game, its result and moves under the header. */
function TitleScreen(props: ScreenProps & { result: GameView | null; celebrate: boolean }) {
  const { t, state, result, actions } = props;
  const active = state.game?.status === "active";
  return (
    <main className="screen">
      <Header t={t} length={state.game?.length ?? state.input.cells.length} />
      {result && (
        <>
          <p className="result">{resultText(t, result)}</p>
          <History t={t} attempts={result.attempts} celebrate={props.celebrate} />
        </>
      )}
      <div className="stack">
        {active ? (
          <button type="button" className="btn primary" onClick={actions.continueGame}>
            {t("button-continue-game")}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={state.busy}
            onClick={actions.newGame}
          >
            {t("button-new-game")}
          </button>
        )}
      </div>
    </main>
  );
}

function GameScreen({ t, state, game, actions }: ScreenProps & { game: GameView }) {
  const first = game.attempts.length === 0;
  return (
    <main className="screen game">
      {/* The intro and the box hint only until the first move */}
      {first && <p className="lead">{t("game-intro", { length: game.length })}</p>}
      <History t={t} attempts={game.attempts} />
      {!first && <p className="remaining">{t("game-remaining", { count: game.remaining ?? 0 })}</p>}
      <div className="your-move">
        <span className="muted">{t(first ? "your-move-hint" : "your-move")}</span>
        <Slots t={t} input={state.input} onSelect={actions.selectCell} />
      </div>
      <Keypad
        t={t}
        used={usedDigits(state.input)}
        busy={state.busy}
        onDigit={actions.digit}
        onErase={actions.erase}
        onCheck={actions.check}
      />
      <button type="button" className="btn slim" onClick={actions.askAbandon}>
        {t("button-abandon")}
      </button>
    </main>
  );
}

/** "Give up" sits right next to the digits, so a slip of the finger needs a question. */
function ConfirmScreen({ t, state, game, actions }: ScreenProps & { game: GameView }) {
  return (
    <main className="screen">
      <History t={t} attempts={game.attempts} />
      <p className="question">{t("abandon-question")}</p>
      <div className="row2">
        <button
          type="button"
          className="btn primary"
          disabled={state.busy}
          onClick={actions.confirmAbandon}
        >
          {t("button-abandon-confirm")}
        </button>
        <button type="button" className="btn" onClick={actions.cancelAbandon}>
          {t("button-abandon-cancel")}
        </button>
      </div>
    </main>
  );
}

/** Pieces of the screens. They only draw what they are given and report taps. */
import { Component, useEffect, type ReactNode } from "react";
import type { AttemptView } from "../shared/api.ts";
import type { Translate } from "./i18n.ts";
import type { Input } from "./input.ts";
import type { Toast as ToastData } from "./use-game.ts";

const BULL = "🐂";
const COW = "🐄";
/** Shown in place of a digit already in the guess, so the keys never shift. */
const USED_DIGIT = "·";
const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
export const TOAST_MS = 1800;

/** "🐂 Bull — …" → the icon drawn large on the left, and the text. */
function splitIcon(text: string): [string, string] {
  const space = text.indexOf(" ");
  return [text.slice(0, space), text.slice(space + 1)];
}

export function Header({ t, length }: { t: Translate; length: number }) {
  return (
    <header className="header">
      <h1>{t("header-title")}</h1>
      <p className="lead">{t("header-rules", { length })}</p>
      <ul className="legend">
        {["header-bull", "header-cow"].map((key) => {
          const [icon, text] = splitIcon(t(key));
          return (
            <li key={key}>
              <span className="ico" aria-hidden="true">
                {icon}
              </span>
              <span>{text}</span>
            </li>
          );
        })}
      </ul>
    </header>
  );
}

/** Moves so far. On a fresh win the winning tiles hop one by one and turn gold. */
export function History(props: { t: Translate; attempts: AttemptView[]; celebrate?: boolean }) {
  const { t, attempts, celebrate = false } = props;
  if (attempts.length === 0) return null;
  return (
    <ol className="history">
      {attempts.map((a) => (
        <li
          key={a.number}
          className={celebrate && a.number === attempts.length ? "move winner" : "move"}
        >
          <span className="n">{a.number}.</span>
          <span className="digits">
            {[...a.guess].map((digit, i) => (
              // The first tile waits 0.3 s: the eye has time to find the row on the new screen
              <span className="chip" key={i} style={{ animationDelay: `${300 + i * 200}ms` }}>
                {digit}
              </span>
            ))}
          </span>
          <span className="score">
            <span className="pair">
              <span className="ico" role="img" aria-label={t("label-bulls")}>
                {BULL}
              </span>
              <span className="count bull">{a.bulls}</span>
            </span>
            <span className="pair">
              <span className="ico" role="img" aria-label={t("label-cows")}>
                {COW}
              </span>
              <span className="count cow">{a.cows}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Slots({
  t,
  input,
  onSelect,
}: {
  t: Translate;
  input: Input;
  onSelect(index: number): void;
}) {
  return (
    <div className="slots" style={{ gridTemplateColumns: `repeat(${input.cells.length}, 48px)` }}>
      {input.cells.map((cell, index) => (
        <button
          key={index}
          type="button"
          className={[
            "slot",
            cell === null ? "" : "filled",
            input.cursor === index ? "cursor" : "",
          ].join(" ")}
          aria-label={t("label-cell", { position: index + 1 })}
          aria-pressed={input.cursor === index}
          onClick={() => onSelect(index)}
        >
          {cell}
        </button>
      ))}
    </div>
  );
}

interface KeypadProps {
  t: Translate;
  used: ReadonlySet<string>;
  busy: boolean;
  onDigit(digit: string): void;
  onErase(): void;
  onCheck(): void;
}

/** Phone layout: ⌫ and ✓ on both sides of 0. */
export function Keypad({ t, used, busy, onDigit, onErase, onCheck }: KeypadProps) {
  const key = (digit: string) =>
    used.has(digit) ? (
      <button
        key={digit}
        type="button"
        className="key used"
        aria-label={t("label-used-digit", { digit })}
      >
        {USED_DIGIT}
      </button>
    ) : (
      <button key={digit} type="button" className="key" onClick={() => onDigit(digit)}>
        {digit}
      </button>
    );
  return (
    <div className="pad">
      {KEYPAD.map(key)}
      <button type="button" className="key erase" aria-label={t("label-erase")} onClick={onErase}>
        {t("button-erase")}
      </button>
      {key("0")}
      <button type="button" className="key check" disabled={busy} onClick={onCheck}>
        {t("button-check")}
      </button>
    </div>
  );
}

export function Toast({
  t,
  toast,
  onDone,
}: {
  t: Translate;
  toast: ToastData | null;
  onDone(): void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      {t(toast.key, toast.args)}
    </div>
  );
}

export function OfflineBar({ t, busy, onRetry }: { t: Translate; busy: boolean; onRetry(): void }) {
  return (
    <div className="offline" role="alert">
      <span>{t("offline")}</span>
      <button type="button" className="btn slim primary" disabled={busy} onClick={onRetry}>
        {t("button-retry")}
      </button>
    </div>
  );
}

/** A full-screen message with one button: a link or an action. */
export function MessageScreen(props: {
  text: string;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  return (
    <main className="screen message">
      <p className="question">{props.text}</p>
      {props.href ? (
        <a className="btn primary" href={props.href}>
          {props.label}
        </a>
      ) : (
        <button type="button" className="btn primary" onClick={props.onClick}>
          {props.label}
        </button>
      )}
    </main>
  );
}

interface BoundaryProps {
  t: Translate;
  onError(error: unknown): void;
  onRetry(): void;
  children: ReactNode;
}

/** A screen that crashes while drawing shows "Something went wrong" instead of a blank page. */
export class ErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  override render() {
    const { t, onRetry, children } = this.props;
    if (!this.state.failed) return children;
    return (
      <MessageScreen text={t("error-unexpected")} label={t("button-retry")} onClick={onRetry} />
    );
  }
}

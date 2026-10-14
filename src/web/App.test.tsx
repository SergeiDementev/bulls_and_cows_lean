import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameView, Language, SessionView } from "../shared/api.ts";
import { ApiError, type Api } from "./api.ts";
import { App } from "./App.tsx";

afterEach(cleanup);

const SECRET = "5017";

/** An in-memory server: "5017" wins, any other guess scores nothing. */
function fakeApi(options: { language?: Language; game?: GameView | null } = {}) {
  let game: GameView | null = options.game ?? null;
  const ended = (status: GameView["status"]): GameView => ({ ...game!, status, secret: SECRET });
  const api = {
    session: vi.fn(async (): Promise<SessionView> => ({
      player: { id: 1, username: null, language: options.language ?? "ru" },
      game,
    })),
    setLanguage: vi.fn(),
    newGame: vi.fn(async () => {
      game = { id: 7, status: "active", length: 4, attempts: [], remaining: null, secret: null };
      return game;
    }),
    guess: vi.fn(async (_id: number, guess: string, attempt: number) => {
      const won = guess === SECRET;
      game = {
        ...game!,
        attempts: [...game!.attempts, { number: attempt, guess, bulls: won ? 4 : 0, cows: 0 }],
        remaining: won ? 1 : 360,
      };
      if (won) game = ended("won");
      return game;
    }),
    abandon: vi.fn(async () => (game = ended("abandoned"))),
    reportError: vi.fn(async () => undefined),
  };
  return api;
}

const reporter = { setScreen: vi.fn(), report: vi.fn() };

function open(api: ReturnType<typeof fakeApi>) {
  const onClose = vi.fn();
  render(
    <App
      api={api as unknown as Api}
      initialLanguage="ru"
      reporter={reporter}
      onClose={onClose}
      onReload={vi.fn()}
    />,
  );
  return { user: userEvent.setup(), onClose };
}

async function type(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const d of digits) await user.click(screen.getByRole("button", { name: d }));
}

describe("Mini App", () => {
  it("opens on the title screen with the rules", async () => {
    open(fakeApi());
    expect(await screen.findByRole("button", { name: "Новая игра" })).toBeTruthy();
    expect(screen.getByText(/число из 4 разных цифр/)).toBeTruthy();
  });

  it("uses the language stored on the server, for screen readers too", async () => {
    open(fakeApi({ language: "en" }));
    expect(await screen.findByRole("button", { name: "New game" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("plays a game to a win", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    expect(screen.getByText(/Загадано число из 4 разных цифр/)).toBeTruthy();

    await type(user, "0123");
    await user.click(screen.getByRole("button", { name: "✓ Проверить" }));
    expect(await screen.findByText("Осталось возможных вариантов: 360")).toBeTruthy();
    expect(api.guess).toHaveBeenLastCalledWith(7, "0123", 1);
    // The boxes are empty again and the digits are free
    expect(screen.getByRole("button", { name: "0" })).toBeTruthy();

    await type(user, SECRET);
    await user.click(screen.getByRole("button", { name: "✓ Проверить" }));
    expect(await screen.findByText("🎉 Вы угадали число 5017 за 2 попытки!")).toBeTruthy();
    expect(document.querySelector(".move.winner")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Новая игра" })).toBeTruthy();
  });

  it("marks digits already typed and labels them for screen readers", async () => {
    const { user } = open(fakeApi());
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, "4");
    expect(screen.getByRole("button", { name: "Цифра 4 уже набрана" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Клетка 1" }).textContent).toBe("4");
  });

  it("erases with a key a screen reader announces as Erase", async () => {
    const { user } = open(fakeApi());
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, "45");
    await user.click(screen.getByRole("button", { name: "Стереть" }));
    expect(screen.getByRole("button", { name: "Клетка 2" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "Клетка 1" }).textContent).toBe("4");
  });

  it("asks for all digits before sending a guess", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, "012");
    await user.click(screen.getByRole("button", { name: "✓ Проверить" }));
    expect(screen.getByRole("status").textContent).toBe("Нужно 4 цифры");
    expect(api.guess).not.toHaveBeenCalled();
  });

  it("hints how to change a digit when every box is full", async () => {
    const { user } = open(fakeApi());
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, "01234");
    expect(screen.getByRole("status").textContent).toBe(
      "Уже набрано 4 цифры. Нажмите на клетку, чтобы заменить",
    );
  });

  it("asks before giving up, and can go back to the game", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await user.click(screen.getByRole("button", { name: "Завершить игру" }));
    await user.click(screen.getByRole("button", { name: "Нет, играть дальше" }));
    expect(screen.getByRole("button", { name: "✓ Проверить" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Завершить игру" }));
    await user.click(screen.getByRole("button", { name: "Да, завершить" }));
    expect(await screen.findByText("Игра завершена. Было загадано число 5017.")).toBeTruthy();
    expect(api.abandon).toHaveBeenCalledWith(7);
  });

  it("offers to resume an active game with its moves", async () => {
    const game: GameView = {
      id: 3,
      status: "active",
      length: 4,
      attempts: [{ number: 1, guess: "0123", bulls: 1, cows: 2 }],
      remaining: 480,
      secret: null,
    };
    const { user } = open(fakeApi({ game }));
    await user.click(await screen.findByRole("button", { name: "Продолжить игру" }));
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("img", { name: "Быки" }).nextSibling?.textContent).toBe("1");
    expect(within(row).getByRole("img", { name: "Коровы" }).nextSibling?.textContent).toBe("2");
    expect(screen.getByText("Осталось возможных вариантов: 480")).toBeTruthy();
  });

  it("keeps the typed digits when the connection drops, and retries", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, "0123");
    api.guess.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await user.click(screen.getByRole("button", { name: "✓ Проверить" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Нет связи с сервером");
    expect(screen.getByRole("button", { name: "Клетка 4" }).textContent).toBe("3");

    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Осталось возможных вариантов: 360")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reloads the game quietly when it moved on elsewhere", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    // Meanwhile the game was given up in another window
    await api.abandon();
    api.guess.mockRejectedValueOnce(new ApiError("game.not_active"));
    await type(user, "0123");
    await user.click(screen.getByRole("button", { name: "✓ Проверить" }));
    expect(await screen.findByText("Игра завершена. Было загадано число 5017.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks to reopen when the sign-in data expired", async () => {
    const api = fakeApi();
    api.session.mockRejectedValueOnce(new ApiError("auth.init_data_expired"));
    const { user, onClose } = open(api);
    await user.click(await screen.findByRole("button", { name: "Закрыть" }));
    expect(
      screen.getByText("Игра открыта слишком давно. Закройте её и откройте снова"),
    ).toBeTruthy();
    expect(onClose).toHaveBeenCalled();
  });

  it("sends a move only once on a double tap", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, "0123");
    let release!: () => void;
    const original = api.guess.getMockImplementation()!;
    api.guess.mockImplementationOnce(async (...args) => {
      await new Promise<void>((r) => (release = r));
      return original(...args);
    });
    const check = screen.getByRole("button", { name: "✓ Проверить" });
    await user.click(check);
    await user.click(check);
    await act(async () => release());
    expect(api.guess).toHaveBeenCalledTimes(1);
  });
});

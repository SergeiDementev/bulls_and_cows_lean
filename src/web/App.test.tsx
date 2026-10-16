import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameView, Language, SessionView, StatsView } from "../shared/api.ts";
import { ApiError, type Api } from "./api.ts";
import { App } from "./App.tsx";

afterEach(cleanup);

const SECRET = "5017";

/** An in-memory server: "5017" wins, any other guess scores nothing. */
const noStats: StatsView = {
  window: 20,
  minWins: 5,
  me: {
    gamesPlayed: 0,
    wins: 0,
    bestResult: null,
    averageAttempts: null,
    averageGames: 0,
    recentWins: 0,
    place: null,
  },
  top: [],
};

function fakeApi(
  options: {
    language?: Language;
    game?: GameView | null;
    stats?: StatsView;
    gameLength?: number;
  } = {},
) {
  let game: GameView | null = options.game ?? null;
  let language: Language = options.language ?? "ru";
  const ended = (status: GameView["status"]): GameView => ({ ...game!, status, secret: SECRET });
  const api = {
    session: vi.fn(async (): Promise<SessionView> => ({
      player: { id: 1, username: null, language },
      gameLength: options.gameLength ?? 4,
      game,
    })),
    setLanguage: vi.fn(async (next: Language) => {
      language = next;
      return { player: { id: 1, username: null, language } };
    }),
    stats: vi.fn(async () => options.stats ?? noStats),
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

  it("takes the number length from the server before the first game", async () => {
    open(fakeApi({ gameLength: 5 }));
    expect(await screen.findByText(/число из 5 разных цифр/)).toBeTruthy();
  });

  /** Holds the next guess until the returned function is called. */
  function holdNextGuess(api: ReturnType<typeof fakeApi>) {
    let release!: () => void;
    const original = api.guess.getMockImplementation()!;
    api.guess.mockImplementationOnce(async (...args) => {
      await new Promise<void>((r) => (release = r));
      return original(...args);
    });
    return () => act(async () => release());
  }

  it("keeps the move pending when the player comes back to the app meanwhile", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, "0123");
    const release = holdNextGuess(api);
    await user.click(screen.getByRole("button", { name: "✓ Проверить" }));

    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    // No sync on top of a move in flight: the check button stays disabled
    expect(api.session).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button", { name: "✓ Проверить" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await release();
  });

  it("keeps digits changed while the answer was on its way", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, "0123");
    const release = holdNextGuess(api);
    await user.click(screen.getByRole("button", { name: "✓ Проверить" }));
    await user.click(screen.getByRole("button", { name: "Стереть" }));
    await release();

    expect(await screen.findByText("Осталось возможных вариантов: 360")).toBeTruthy();
    expect(
      ["Клетка 1", "Клетка 2", "Клетка 3", "Клетка 4"].map(
        (n) => screen.getByRole("button", { name: n }).textContent,
      ),
    ).toEqual(["0", "1", "2", ""]);
  });

  it("clears the boxes after a move when nothing was changed meanwhile", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, "0123");
    await user.click(screen.getByRole("button", { name: "✓ Проверить" }));
    await screen.findByText("Осталось возможных вариантов: 360");
    expect(screen.getByRole("button", { name: "Клетка 1" }).textContent).toBe("");
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

describe("stats", () => {
  const stats = (me: Partial<StatsView["me"]>, top: StatsView["top"] = []): StatsView => ({
    ...noStats,
    me: { ...noStats.me, ...me },
    top,
  });
  const entry = (
    place: number,
    playerId: number,
    username: string | null,
    averageAttempts: number,
  ) => ({
    place,
    playerId,
    username,
    averageAttempts,
    recentWins: 5,
  });

  async function openStats(api: ReturnType<typeof fakeApi>) {
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Статистика" }));
    await screen.findByText("📊 Ваша статистика");
    return user;
  }

  it("invites to play before the first game", async () => {
    await openStats(fakeApi());
    expect(screen.getByText("Сыграйте первую игру — здесь появится ваша статистика.")).toBeTruthy();
    expect(screen.getByText("Пока в рейтинге никого нет — станьте первым.")).toBeTruthy();
    expect(screen.getByText("До рейтинга — ещё 5 побед.")).toBeTruthy();
    expect(
      screen.getByText("Учитываются игроки, у которых не меньше 5 побед среди последних 20 игр."),
    ).toBeTruthy();
  });

  it("shows the player's tiles; no best result without a win", async () => {
    const me = { gamesPlayed: 3, wins: 0, averageAttempts: 10, averageGames: 3 };
    await openStats(fakeApi({ stats: stats(me) }));
    expect(screen.getByText("Сыграно игр").nextSibling?.textContent).toBe("3");
    expect(screen.getByText("Среднее за 3 игры").nextSibling?.textContent).toBe("10");
    expect(screen.queryByText("Лучший результат")).toBeNull();
  });

  it("shows the best result and a localized average", async () => {
    const me = {
      gamesPlayed: 12,
      wins: 10,
      bestResult: 4,
      averageAttempts: 6.43,
      averageGames: 12,
    };
    await openStats(fakeApi({ stats: stats(me) }));
    expect(screen.getByText("Лучший результат").nextSibling?.textContent).toBe("4");
    expect(screen.getByText("Среднее за 12 игр").nextSibling?.textContent).toBe("6,4");
  });

  it("names players without a username by number and highlights the player's own row", async () => {
    const me = {
      gamesPlayed: 9,
      wins: 6,
      recentWins: 6,
      averageAttempts: 5.9,
      averageGames: 9,
      place: 2,
    };
    await openStats(
      fakeApi({ stats: stats(me, [entry(1, 3, "anna_k", 5.4), entry(2, 1, null, 5.9)]) }),
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["1.anna_k5,4", "2.Игрок #15,9"]);
    expect(rows[1]!.className).toBe("me");
    // In the top: no separate line about the place
    expect(screen.queryByText(/Вы на/)).toBeNull();
  });

  it("gives the place of a player outside the top", async () => {
    const me = {
      gamesPlayed: 20,
      wins: 9,
      recentWins: 9,
      averageAttempts: 7.1,
      averageGames: 20,
      place: 14,
    };
    await openStats(fakeApi({ stats: stats(me, [entry(1, 3, "anna_k", 5.4)]) }));
    expect(screen.getByText("Вы на 14-м месте со средним 7,1.")).toBeTruthy();
  });

  it("counts the wins still missing for the rating", async () => {
    const me = { gamesPlayed: 4, wins: 3, recentWins: 3, averageAttempts: 6, averageGames: 4 };
    await openStats(fakeApi({ stats: stats(me, [entry(1, 3, "anna_k", 5.4)]) }));
    expect(screen.getByText("До рейтинга — ещё 2 победы.")).toBeTruthy();
  });

  it("goes back to the game result without replaying the win", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    await type(user, SECRET);
    await user.click(screen.getByRole("button", { name: "✓ Проверить" }));
    await screen.findByText("🎉 С первой попытки! Загадано было 5017.");
    await user.click(screen.getByRole("button", { name: "Статистика" }));
    await user.click(await screen.findByRole("button", { name: "Назад" }));
    expect(screen.getByText("🎉 С первой попытки! Загадано было 5017.")).toBeTruthy();
    expect(document.querySelector(".move.winner")).toBeNull();
  });
});

describe("language", () => {
  it("switches the whole Mini App and stores the choice on the server", async () => {
    const api = fakeApi();
    const { user } = open(api);
    await user.click(await screen.findByRole("button", { name: "🌐 English" }));
    expect(await screen.findByRole("button", { name: "New game" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "🌐 Русский" })).toBeTruthy();
    expect(api.setLanguage).toHaveBeenCalledWith("en");
    expect(document.documentElement.lang).toBe("en");

    await user.click(screen.getByRole("button", { name: "🌐 Русский" }));
    expect(await screen.findByRole("button", { name: "Новая игра" })).toBeTruthy();
  });

  it("is not offered during a game", async () => {
    const { user } = open(fakeApi());
    await user.click(await screen.findByRole("button", { name: "Новая игра" }));
    expect(screen.queryByRole("button", { name: "🌐 English" })).toBeNull();
  });
});

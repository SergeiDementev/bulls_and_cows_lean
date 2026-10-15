import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInitData } from "../../src/server/init-data.ts";

/** Plays the part of Telegram: the signed initData and the WebApp object the page expects. */
async function openAsPlayer(page: Page, languageCode = "ru") {
  const user = { id: 100_000 + Math.floor(Math.random() * 1e6), language_code: languageCode };
  const initData = signInitData(user, "e2e-bot-token", Math.floor(Date.now() / 1000));
  await page.route("https://telegram.org/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await page.addInitScript((data) => {
    const noop = () => undefined;
    Object.assign(window, {
      Telegram: {
        WebApp: {
          initData: data,
          initDataUnsafe: {},
          colorScheme: "light",
          ready: noop,
          expand: noop,
          close: noop,
          onEvent: noop,
        },
      },
    });
  }, initData);
  await page.goto("/");
  return user;
}

async function latestSecret(telegramId: number): Promise<string> {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `${url.pathname}_e2e`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select g.secret from games g join players p on p.id = g.player_id
       where p.telegram_id = $1 order by g.id desc limit 1`,
      [telegramId],
    );
    return rows[0].secret;
  } finally {
    await client.end();
  }
}

async function typeGuess(page: Page, digits: string) {
  for (const d of digits) await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "✓ Проверить" }).click();
}

test("plays a game to a win", async ({ page }) => {
  const user = await openAsPlayer(page);
  await page.getByRole("button", { name: "Новая игра" }).click();
  // The game exists once its screen is shown; read the secret only then
  await expect(page.getByRole("button", { name: "✓ Проверить" })).toBeVisible();
  const secret = await latestSecret(user.id);
  const miss = ["0123", "4567", "8901"].find((g) => g !== secret)!;
  await typeGuess(page, miss);
  await expect(page.getByText(/^Осталось возможных вариантов: [\d\s]+$/)).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(1);

  await typeGuess(page, secret);
  await expect(page.getByText(`🎉 Вы угадали число ${secret} за 2 попытки!`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Новая игра" })).toBeVisible();
});

test("has no accessibility violations on the main screens", async ({ page }) => {
  const check = async () => {
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual(
      [],
    );
  };
  await openAsPlayer(page);
  await expect(page.getByRole("button", { name: "Новая игра" })).toBeVisible();
  await check();

  await page.getByRole("button", { name: "Новая игра" }).click();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await check();
});

test("shows stats after a game and switches the language", async ({ page }) => {
  await openAsPlayer(page);
  await page.getByRole("button", { name: "Новая игра" }).click();
  await typeGuess(page, "0123");
  await page.getByRole("button", { name: "Завершить игру" }).click();
  await page.getByRole("button", { name: "Да, завершить" }).click();
  await expect(page.getByText(/^Игра завершена\. Было загадано число \d{4}\.$/)).toBeVisible();

  await page.getByRole("button", { name: "Статистика" }).click();
  // One abandoned game with a move counts as 10 attempts
  await expect(page.getByText("Сыграно игр")).toBeVisible();
  await expect(page.getByText("Среднее за последнюю игру")).toBeVisible();
  await expect(page.getByText("До рейтинга — ещё 5 побед.")).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("button", { name: "Назад" }).click();
  await page.getByRole("button", { name: "🌐 English" }).click();
  await expect(page.getByRole("button", { name: "New game" })).toBeVisible();
  await expect(page.getByText(/^Game over\. The number was \d{4}\.$/)).toBeVisible();

  // The choice is stored on the server: a fresh open is in English too
  await page.reload();
  await expect(page.getByRole("button", { name: "New game" })).toBeVisible();
});

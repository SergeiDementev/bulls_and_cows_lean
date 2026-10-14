import { ESLint } from "eslint";
import { describe, expect, it, vi } from "vitest";

const eslint = new ESLint();

// The first lint loads TypeScript and the React plugins: slow, especially under coverage
vi.setConfig({ testTimeout: 30_000 });

/** Lints `code` as if it lived at `filePath` and returns the restricted-import messages. */
async function boundaryErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === "no-restricted-imports")
    .map((m) => m.message);
}

describe("player-facing text", () => {
  it("is not written into Mini App markup", async () => {
    const [result] = await eslint.lintText("export const A = () => <p>Новая игра</p>;", {
      filePath: "src/web/A.tsx",
    });
    expect(result?.messages.map((m) => m.ruleId)).toContain("react/jsx-no-literals");
  });

  it("may come from a translation", async () => {
    const [result] = await eslint.lintText(
      'export const A = ({ t }: { t: (k: string) => string }) => <p>{t("x")}.</p>;',
      { filePath: "src/web/A.tsx" },
    );
    expect(result?.messages.filter((m) => m.ruleId === "react/jsx-no-literals")).toEqual([]);
  });
});

describe("module boundaries", () => {
  it.each([
    ["src/domain/score.ts", `import { readFileSync } from "node:fs";`],
    ["src/domain/score.ts", `import { z } from "zod";`],
    ["src/domain/score.ts", `import type { GameView } from "../shared/api.ts";`],
    ["src/domain/score.ts", `import { app } from "../server/app.ts";`],
    ["src/shared/api.ts", `import { score } from "../domain/score.ts";`],
    ["src/server/app.ts", `import { App } from "../web/App.tsx";`],
    ["src/web/App.tsx", `import { score } from "../domain/score.ts";`],
    ["src/web/App.tsx", `import { app } from "../server/app.ts";`],
  ])("%s rejects: %s", async (filePath, code) => {
    expect(await boundaryErrors(filePath, code)).not.toEqual([]);
  });

  it.each([
    ["src/domain/game.ts", `import { score } from "./score.ts";`],
    ["src/domain/game.test.ts", `import fc from "fast-check";`],
    ["src/server/app.ts", `import { score } from "../domain/score.ts";`],
    ["src/server/app.ts", `import type { GameView } from "../shared/api.ts";`],
    ["src/web/App.tsx", `import type { GameView } from "../shared/api.ts";`],
  ])("%s allows: %s", async (filePath, code) => {
    expect(await boundaryErrors(filePath, code)).toEqual([]);
  });
});

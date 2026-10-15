import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FluentResource } from "@fluent/bundle";
import { describe, expect, it } from "vitest";
import { createTranslations, keysOf } from "../src/shared/i18n.ts";

const ru = readFileSync("src/locales/ru.ftl", "utf8");
const en = readFileSync("src/locales/en.ftl", "utf8");

/** Variables each message uses: { $length } → "length". */
function variablesOf(source: string): Record<string, string[]> {
  return Object.fromEntries(
    new FluentResource(source).body.map((entry) => [
      entry.id,
      [...new Set(JSON.stringify(entry).match(/"name":"[a-zA-Z]+"/g) ?? [])]
        .map((m) => m.slice(8, -1))
        .filter((name) => name !== "NUMBER")
        .sort(),
    ]),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("texts", () => {
  it("parse without errors", () => {
    expect(() => createTranslations({ ru, en })).not.toThrow();
  });

  it("have the same keys in every language", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(ru).sort());
  });

  it("use the same variables in every language", () => {
    expect(variablesOf(en)).toEqual(variablesOf(ru));
  });

  it("are all used in the code", () => {
    const code = sourceFiles("src")
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const unused = keysOf(ru).filter((key) => !code.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });

  it("fail loudly on a missing key", () => {
    expect(() => createTranslations({ ru, en })("ru")("no-such-key")).toThrow(/no-such-key/);
  });
});

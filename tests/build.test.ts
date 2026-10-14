import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The production Mini App must not be able to sign in on its own: the dev-only signing
 * (vite.config.ts) and the window.__DEV_INIT_DATA__ fallback stay out of the bundle.
 */
describe("production bundle", { timeout: 60_000 }, () => {
  const outDir = mkdtempSync(join(tmpdir(), "bulls-build-"));
  let bundle = "";

  beforeAll(async () => {
    // Vitest sets NODE_ENV=test, which would make Vite produce a development bundle
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await build({ mode: "production", logLevel: "silent", build: { outDir, emptyOutDir: true } });
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
    const assets = join(outDir, "assets");
    bundle = readdirSync(assets)
      .map((name) => readFileSync(join(assets, name), "utf8"))
      .join("\n");
    bundle += readFileSync(join(outDir, "index.html"), "utf8");
  });

  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it("contains the Mini App", () => {
    expect(bundle).toContain("telegram-web-app.js");
    expect(bundle).toContain("/api/session");
  });

  it.each(["WebAppData", "__DEV_INIT_DATA__", "createHmac", "dev_player"])(
    "has no %s",
    (marker) => {
      expect(bundle).not.toContain(marker);
    },
  );
});

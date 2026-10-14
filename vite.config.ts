import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { signInitData } from "./src/server/init-data.ts";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

/**
 * Dev server only: a normal browser has no Telegram initData, so sign some here with BOT_TOKEN
 * from .env. The token stays in Node; the page gets only the signed string. `apply: "serve"`
 * keeps this out of every build — tests/build.test.ts checks the bundle.
 */
function devInitData(botToken: string | undefined): Plugin {
  return {
    name: "dev-init-data",
    apply: "serve",
    transformIndexHtml() {
      if (!botToken) return [];
      const user = { id: 1001, username: "dev_player", language_code: "ru" };
      const initData = signInitData(user, botToken, Math.floor(Date.now() / 1000));
      return [
        { tag: "script", children: `window.__DEV_INIT_DATA__ = ${JSON.stringify(initData)};` },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  // "^/api/", not "/api": the module src/web/api.ts is served as /api.ts and must not be proxied
  const proxy = { "^/api/": `http://localhost:${env.PORT ?? 3000}` };
  return {
    root: "src/web",
    envDir: projectRoot,
    plugins: [react(), devInitData(env.BOT_TOKEN)],
    build: { outDir: "../../dist/web", emptyOutDir: true },
    server: { proxy },
    preview: { proxy },
  };
});

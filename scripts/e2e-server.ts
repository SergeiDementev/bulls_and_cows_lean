/**
 * The server for end-to-end tests (playwright.config.ts): a fresh database next to the dev one,
 * then the normal server entry point on its own port.
 */
import { existsSync } from "node:fs";
import pg from "pg";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_URL is not set: run `pnpm db:up` and fill .env");

const url = new URL(adminUrl);
const name = `${url.pathname.slice(1)}_e2e`;
url.pathname = `/${name}`;

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`drop database if exists "${name}" with (force)`);
await admin.query(`create database "${name}"`);
await admin.end();

Object.assign(process.env, {
  DATABASE_URL: url.toString(),
  BOT_TOKEN: "e2e-bot-token",
  PORT: "3100",
  LOG_LEVEL: "warn",
});
await import("../src/server/main.ts");

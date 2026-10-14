/** Vitest global setup for *.db.test.ts: a fresh, migrated test database next to the dev one. */
import { existsSync } from "node:fs";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { createDb } from "./db.ts";
import { migrateToLatest } from "./migrate.ts";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("DATABASE_URL is not set: run `pnpm db:up` and fill .env");

  const url = new URL(adminUrl);
  const name = `${url.pathname.slice(1)}_test`;
  url.pathname = `/${name}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const db = createDb(url.toString(), 1);
  try {
    await migrateToLatest(db);
  } finally {
    await db.destroy();
  }
  project.provide("testDatabaseUrl", url.toString());
}

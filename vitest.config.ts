import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
          exclude: ["src/**/*.db.test.ts"],
        },
      },
      {
        test: {
          name: "db",
          include: ["src/**/*.db.test.ts"],
          globalSetup: ["src/server/test-db-setup.ts"],
          // One shared test database, cleaned before each test: files must not run side by side
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/server/test-*.ts", "src/server/main.ts"],
      reporter: ["text", "html"],
      thresholds: {
        "src/domain/**": { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});

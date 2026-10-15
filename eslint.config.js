import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const DOC = "see docs/decisions.md, «Устройство»";

/** Forbids imports whose path matches `regex`; the message explains the boundary. */
const forbid = (...rules) => ({
  "no-restricted-imports": [
    "error",
    { patterns: rules.map(([regex, message]) => ({ regex, message })) },
  ],
});

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "coverage/",
      "reports/",
      "playwright-report/",
      "test-results/",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  {
    files: ["src/web/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
    plugins: { ...reactHooks.configs.flat["recommended-latest"].plugins, react },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      // Every player-facing text comes from src/locales/*.ftl; only punctuation may sit in markup
      "react/jsx-no-literals": [
        "error",
        { noStrings: false, ignoreProps: true, allowedStrings: ["."] },
      ],
    },
  },

  // Module boundaries. tests/architecture.test.ts proves these rules actually fire.
  {
    files: ["src/domain/**"],
    // Tests sit next to the rules and need the test libraries
    ignores: ["**/*.test.ts"],
    rules: forbid(
      ["^(?!\\.)", `domain is pure rules: no packages and no Node.js modules (${DOC})`],
      ["(^|/)(server|web|shared)/", `domain does not depend on other folders (${DOC})`],
    ),
  },
  {
    files: ["src/shared/**"],
    rules: forbid([
      "(^|/)(domain|server|web)/",
      `shared holds API types only and depends on nothing (${DOC})`,
    ]),
  },
  {
    files: ["src/server/**"],
    rules: forbid(["(^|/)web/", `server does not import client code (${DOC})`]),
  },
  {
    files: ["src/web/**"],
    rules: forbid([
      "(^|/)(domain|server)/",
      `the client does not know game rules: it only shows server data (${DOC})`,
    ]),
  },
);

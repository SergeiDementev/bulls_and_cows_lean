/**
 * The load test (docs/load.md): the production stack in local Docker, a database of 10 000
 * players, k6 playing as many players at once, then a report in tests/load/out/report.md.
 *   pnpm test:load [--players 1000]
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signInitData } from "../src/server/init-data.ts";

const players = Number(process.argv[process.argv.indexOf("--players") + 1]) || 1000;
// --direct: k6 talks to the server itself, past Caddy — to tell their costs apart
const direct = process.argv.includes("--direct");
const BOT_TOKEN = "load-test-token";
const out = "tests/load/out";
mkdirSync(out, { recursive: true });

// Passwords for a throwaway stack; the file lives outside the repository and is deleted at the end
const envFile = join(tmpdir(), `bulls-load-${process.pid}.env`);
const secret = () => randomBytes(24).toString("hex");
writeFileSync(
  envFile,
  [
    "DOMAIN=bulls.internal",
    "POSTGRES_DB=bulls",
    `POSTGRES_PASSWORD=${secret()}`,
    `APP_DB_PASSWORD=${secret()}`,
    `BOT_TOKEN=${BOT_TOKEN}`,
    `WEBHOOK_SECRET=${secret()}`,
    "LOG_LEVEL=info",
    `PLAYERS=${players}`,
    ...(direct ? ["BASE_URL=http://app:3000"] : []),
  ].join("\n"),
);

const compose = (...args: string[]) => [
  "compose",
  "-p",
  "bulls-load",
  "-f",
  "docker/compose.prod.yml",
  "-f",
  "docker/compose.load.yml",
  "--env-file",
  envFile,
  ...args,
];
const docker = (args: string[], options: { quiet?: boolean } = {}) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
const step = (text: string) => console.log(`\n== ${text}`);
const psql = (sql: string) =>
  docker(
    compose("exec", "-T", "db", "psql", "-U", "postgres", "-d", "bulls", "-tAF", "\t", "-c", sql),
  );

try {
  step("Building and starting the stack");
  docker(compose("up", "-d", "--build", "--wait", "db", "app", "caddy"));

  step("Filling the database: 10 000 players × 20 games");
  const seedStart = Date.now();
  docker(
    compose(
      "exec",
      "-T",
      "db",
      "psql",
      "-q",
      "-U",
      "postgres",
      "-d",
      "bulls",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "/load/seed.sql",
    ),
  );
  const sizes = psql(
    "select count(*) from players; select count(*) from games; select count(*) from guesses;",
  );
  console.log(
    `seeded in ${Math.round((Date.now() - seedStart) / 1000)} s:`,
    sizes.trim().split("\n").join(" / "),
  );

  step(`Signing initData for ${players} players`);
  const now = Math.floor(Date.now() / 1000);
  const initData = Array.from({ length: players }, (_, i) =>
    signInitData({ id: 1_000_000 + i, language_code: i % 3 ? "ru" : "en" }, BOT_TOKEN, now),
  );
  writeFileSync(join(out, "init-data.json"), JSON.stringify(initData));

  step("Running k6 (about 5 minutes)");
  const samples: { name: string; cpu: number; memMiB: number; at: number }[] = [];
  const k6Start = Date.now();
  const sampler = setInterval(() => {
    const ps = spawn("docker", ["stats", "--no-stream", "--format", "{{json .}}"]);
    let text = "";
    ps.stdout.on("data", (chunk) => (text += chunk));
    ps.on("close", () => {
      for (const line of text.trim().split("\n")) {
        if (!line) continue;
        const s = JSON.parse(line) as { Name: string; CPUPerc: string; MemUsage: string };
        if (!s.Name.startsWith("bulls-load-")) continue;
        const mem = s.MemUsage.split("/")[0]!.trim();
        const memMiB =
          parseFloat(mem) * (mem.endsWith("GiB") ? 1024 : mem.endsWith("KiB") ? 1 / 1024 : 1);
        samples.push({
          name: s.Name.replace(/^bulls-load-|-\d+$/g, ""),
          cpu: parseFloat(s.CPUPerc),
          memMiB,
          at: Date.now() - k6Start,
        });
      }
    });
  }, 5000);
  // Asynchronous on purpose: a synchronous call would block the sampler timer for the whole run.
  // k6 exits non-zero when a threshold fails; the report shows which
  await new Promise((resolve) => {
    const k6 = spawn(
      "docker",
      compose("run", "--rm", "k6", "run", "--quiet", "/load/scenario.js"),
      {
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    k6.on("close", resolve);
  });
  clearInterval(sampler);

  step("Collecting results");
  const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
  const queries = psql(`
    select calls, round(mean_exec_time::numeric, 2), round(total_exec_time::numeric), left(regexp_replace(query, '\\s+', ' ', 'g'), 140)
    from pg_stat_statements
    where query not ilike '%pg_stat_statements%'
    order by total_exec_time desc limit 10`);
  const slow = docker(compose("logs", "app", "--no-log-prefix"), { quiet: true })
    .split("\n")
    .filter((l) => l.includes('"msg":"slow request"'));
  writeFileSync(
    join(out, "report.md"),
    report(summary, samples, queries, slow) + timeline(samples, slow, k6Start),
  );
  console.log(readFileSync(join(out, "report.md"), "utf8"));
} finally {
  step("Removing the stack");
  docker(compose("--profile", "k6", "down", "-v", "--remove-orphans"));
  rmSync(envFile, { force: true });
}

type Trend = Record<string, number>;

/** Per 30 s of the run: slow answers and container CPU — shows whether delays cluster. */
function timeline(
  samples: { name: string; cpu: number; at: number }[],
  slow: string[],
  start: number,
): string {
  const bucket = (ms: number) => Math.floor(ms / 30_000);
  const entries = slow.map((l) => JSON.parse(l) as { time: number; ms: number });
  const last = Math.max(
    0,
    ...samples.map((x) => bucket(x.at)),
    ...entries.map((e) => bucket(e.time - start)),
  );
  const rows = [];
  for (let b = 0; b <= last; b++) {
    const own = entries
      .filter((e) => bucket(e.time - start) === b)
      .map((e) => e.ms)
      .sort((x, y) => x - y);
    const cpu = (name: string) => {
      const xs = samples.filter((x) => x.name === name && bucket(x.at) === b).map((x) => x.cpu);
      return xs.length ? (Math.max(...xs) / 100).toFixed(1) : "—";
    };
    const median = own.length ? own[Math.floor(own.length / 2)] : "—";
    rows.push(
      `| ${b * 30}–${b * 30 + 30} с | ${own.length} | ${median} | ${cpu("app")} | ${cpu("caddy")} | ${cpu("db")} |`,
    );
  }
  return `
По времени (медленные ответы — строки «slow request»; процессор — пик за 30 с, в ядрах):

| Время | Медленных | Их медиана, мс | app | caddy | db |
|---|---|---|---|---|---|
${rows.join("\n")}
`;
}

/** Where slow answers spent their time: in the database or elsewhere (the server's own work). */
function slowBreakdown(lines: string[]): string {
  if (lines.length === 0) return "";
  const entries = lines.map(
    (l) => JSON.parse(l) as { ms: number; dbMs: number; dbQueries: number },
  );
  const sorted = (xs: number[]) => xs.sort((a, b) => a - b);
  const ms = sorted(entries.map((e) => e.ms));
  const dbShare =
    entries.reduce((sum, e) => sum + e.dbMs, 0) / entries.reduce((sum, e) => sum + e.ms, 0);
  const queries = sorted(entries.map((e) => e.dbQueries));
  return `: медиана ${ms[Math.floor(ms.length / 2)]} мс, максимум ${ms.at(-1)} мс; база — ${Math.round(dbShare * 100)}% их времени; запросов к базе в одном ответе — до ${queries.at(-1)}`;
}

function report(
  summary: { metrics: Record<string, { values: Trend }> },
  samples: { name: string; cpu: number; memMiB: number }[],
  queries: string,
  slow: string[],
): string {
  const m = summary.metrics;
  const ms = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v)} мс`);
  const rows = ["session", "new_game", "guess", "stats", "abandon"].map((name) => {
    const t = m[`http_req_duration{name:${name}}`]?.values ?? {};
    return `| ${name} | ${ms(t.med)} | ${ms(t["p(95)"])} | ${ms(t["p(99)"])} | ${ms(t.max)} |`;
  });
  const peaks = [...new Set(samples.map((s) => s.name))].map((name) => {
    const own = samples.filter((s) => s.name === name);
    const cpu = Math.max(...own.map((s) => s.cpu));
    const mem = Math.max(...own.map((s) => s.memMiB));
    return `| ${name} | ${(cpu / 100).toFixed(2)} ядра | ${Math.round(mem)} МБ |`;
  });
  const top = queries
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [calls, mean, total, query] = line.split("\t");
      return `| ${calls} | ${mean} | ${total} | \`${query?.replaceAll("|", "\\|")}\` |`;
    });
  const reqs = m.http_reqs?.values ?? {};
  const failed = m.http_req_failed?.values.rate ?? 0;
  return `# Нагрузочный замер — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC

${players} одновременных игроков на пике; база — 10 000 игроков × 20 партий${direct ? "; k6 → сервер напрямую, без Caddy" : "; через Caddy (HTTPS)"}.

- Запросов всего: ${reqs.count ?? "—"}, в секунду в среднем: ${(reqs.rate ?? 0).toFixed(1)}
- Ошибок: ${(failed * 100).toFixed(2)}%
- Строк «slow request» (ответ ≥ 200 мс) в логе сервера: ${slow.length}${slowBreakdown(slow)}

| Запрос | Медиана | 95% | 99% | Максимум |
|---|---|---|---|---|
${rows.join("\n")}

| Контейнер | Пик процессора | Пик памяти |
|---|---|---|
${peaks.join("\n")}

Запросы к базе с наибольшим суммарным временем (pg_stat_statements):

| Вызовов | Среднее, мс | Всего, мс | Запрос |
|---|---|---|---|
${top.join("\n")}
`;
}

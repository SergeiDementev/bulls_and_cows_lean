/* global __ENV, __VU, open */
/**
 * k6 scenario (scripts/load-test.ts runs it). Each virtual player does what a person does:
 * open the Mini App, start or resume a game, make 3–6 moves, thinking 10–20 s over each, sometimes
 * open the stats, give up if not won, rest, repeat.
 */
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import http from "k6/http";

const BASE = __ENV.BASE_URL;
const PLAYERS = Number(__ENV.PLAYERS || 1000);
const STATS_SHARE = 0.3;

// Signed initData per virtual player, prepared by scripts/load-test.ts
const initData = new SharedArray("initData", () => JSON.parse(open("/load/out/init-data.json")));

export const options = {
  // Caddy's certificate for the internal name is its own, not a public one
  insecureSkipTLSVerify: true,
  scenarios: {
    players: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Math.round(PLAYERS / 4) },
        { duration: "60s", target: PLAYERS },
        { duration: "180s", target: PLAYERS },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  summaryTrendStats: ["med", "p(95)", "p(99)", "max"],
  // A threshold per request also makes k6 report each request type separately
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:session}": ["p(95)<500"],
    "http_req_duration{name:new_game}": ["p(95)<500"],
    "http_req_duration{name:guess}": ["p(95)<500"],
    "http_req_duration{name:stats}": ["p(95)<500"],
    "http_req_duration{name:abandon}": ["p(95)<500"],
  },
};

function randomGuess() {
  const digits = "0123456789".split("");
  for (let i = 0; i < 4; i++) {
    const j = i + Math.floor(Math.random() * (10 - i));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, 4).join("");
}

export default function () {
  const auth = `tma ${initData[(__VU - 1) % initData.length]}`;
  // No body, no content type: an empty body sent as JSON is a malformed request
  const empty = (name) => ({ headers: { authorization: auth }, tags: { name } });
  const json = (name) => ({
    headers: { authorization: auth, "content-type": "application/json" },
    tags: { name },
  });

  const session = http.post(`${BASE}/api/session`, null, empty("session"));
  if (!check(session, { "session 200": (r) => r.status === 200 })) return sleep(5);
  let game = session.json("game");

  if (!game || game.status !== "active") {
    const started = http.post(`${BASE}/api/games`, null, empty("new_game"));
    if (!check(started, { "new game 201": (r) => r.status === 201 })) return sleep(5);
    game = started.json();
  }

  const moves = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < moves && game.status === "active"; i++) {
    // A person reads the answer, thinks and taps four digits (author's decision, docs/load.md)
    sleep(10 + Math.random() * 10);
    const body = JSON.stringify({ guess: randomGuess(), attempt: game.attempts.length + 1 });
    const res = http.post(`${BASE}/api/games/${game.id}/guesses`, body, json("guess"));
    if (!check(res, { "guess 200": (r) => r.status === 200 })) return sleep(5);
    game = res.json();
  }

  if (Math.random() < STATS_SHARE) {
    sleep(1);
    const res = http.get(`${BASE}/api/stats`, empty("stats"));
    check(res, { "stats 200": (r) => r.status === 200 });
  }

  if (game.status === "active") {
    sleep(1);
    const res = http.post(`${BASE}/api/games/${game.id}/abandon`, null, empty("abandon"));
    check(res, { "abandon 200": (r) => r.status === 200 });
  }

  sleep(2 + Math.random() * 3);
}

/** Raw numbers for the report that scripts/load-test.ts writes. */
export function handleSummary(data) {
  return { "/load/out/summary.json": JSON.stringify(data, null, 2), stdout: "k6 done\n" };
}

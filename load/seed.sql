-- A realistic database for the load test (scripts/load-test.ts): 10 000 players, 20 finished
-- games each, ~1.5 million moves, and the rating summary filled in. Values only have to be
-- plausible and pass the table constraints; the load test measures speed, not game logic.

insert into players (telegram_id, username, language, created_at)
select i, 'player_' || i, case when i % 3 = 0 then 'en' else 'ru' end, now() - interval '90 days'
from generate_series(1, 10000) i;

insert into games (player_id, length, secret, status, attempt_count, started_at, finished_at)
select
  p.id,
  4,
  (array['0123', '4567', '8901', '2345', '6789', '1357', '2468', '9876'])[1 + (p.id + n) % 8],
  case when random() < 0.8 then 'won' else 'abandoned' end,
  3 + floor(random() * 10)::int,
  p.created_at + n * interval '3 days',
  p.created_at + n * interval '3 days' + interval '10 minutes'
from players p
cross join generate_series(1, 20) n;

insert into guesses (game_id, attempt_no, value, bulls, cows, remaining, created_at)
select
  g.id,
  n,
  (array['0123', '4567', '8901', '2345', '6789', '1357', '2468', '9876'])[1 + n % 8],
  case when g.status = 'won' and n = g.attempt_count then 4 else n % 3 end,
  case when g.status = 'won' and n = g.attempt_count then 0 else 1 end,
  greatest(1, 5040 / (n * n)),
  g.started_at + n * interval '30 seconds'
from games g
cross join lateral generate_series(1, g.attempt_count) n;

-- The summary as the server keeps it: all 20 games fit in the rating window
update players p
set rating_average = s.average, rating_wins = s.wins, rating_games = s.games
from (
  select
    player_id,
    avg(case when status = 'won' then attempt_count else greatest(10, attempt_count) end) as average,
    count(*) filter (where status = 'won') as wins,
    count(*) as games
  from games
  group by player_id
) s
where s.player_id = p.id;

analyze;

create extension if not exists pg_stat_statements;
-- Count only what the load test does, not the seeding above
select pg_stat_statements_reset();

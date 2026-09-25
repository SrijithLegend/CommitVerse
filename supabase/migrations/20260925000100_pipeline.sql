-- Pipeline support: synthetic stars, delta tracking, GH Archive rollups.

-- Synthetic stars (staging universe / local demo) are never fetched from GitHub.
alter table github_users add column synthetic boolean not null default false;

-- Delta layer (§6.6): bodies changed since the last bake.
alter table bodies add column delta_at timestamptz;
create index bodies_delta on bodies (delta_at) where delta_at is not null;

-- GH Archive (§8.4 multiplier 3): per-actor daily push counts for mapped users.
create table archive_daily (
  github_id bigint not null references github_users on delete cascade,
  day       date not null,
  pushes    integer not null default 0,
  primary key (github_id, day)
);
alter table archive_daily enable row level security;

create table archive_hours (
  hour        timestamptz primary key,
  ingested_at timestamptz not null default now(),
  actors      integer not null default 0
);
alter table archive_hours enable row level security;

-- GitHub API cost log (M1 AC: mean points per fetch).
create table github_cost_log (
  id         bigserial primary key,
  shape      text not null,
  cost       integer not null,
  remaining  integer,
  created_at timestamptz not null default now()
);
create index github_cost_log_recent on github_cost_log (created_at desc);
alter table github_cost_log enable row level security;

-- Dead-letter record for local-mode jobs (pg-boss has its own in production).
create table job_failures (
  id         bigserial primary key,
  queue      text not null,
  data       jsonb not null,
  error      text not null,
  failed_at  timestamptz not null default now()
);
alter table job_failures enable row level security;

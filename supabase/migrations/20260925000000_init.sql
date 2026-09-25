-- Commitverse §9 — initial schema. Forward-only. All timestamps timestamptz (UTC).
create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ─── Core: GitHub mirror ─────────────────────────────────────────────
create table github_users (
  github_id        bigint primary key,
  login            citext not null unique,
  name             text,
  avatar_url       text,
  bio              text,
  created_at_gh    timestamptz not null,
  is_opted_out     boolean not null default false,
  first_seen_at    timestamptz not null default now(),
  last_fetched_at  timestamptz,
  next_refresh_at  timestamptz not null default now(),
  refresh_tier     smallint not null default 4 check (refresh_tier between 0 and 4),
  fetch_error      text,
  last_viewed_at   timestamptz,
  under_review     boolean not null default false
);
create index github_users_login_trgm on github_users using gin (login gin_trgm_ops);
create index github_users_name_trgm  on github_users using gin (name gin_trgm_ops);
create index github_users_login_prefix on github_users (lower(login::text) text_pattern_ops);
create index github_users_due        on github_users (next_refresh_at) where not is_opted_out;

create table login_aliases (
  old_login  citext primary key,
  github_id  bigint not null references github_users on delete cascade,
  changed_at timestamptz not null default now()
);

create table user_metrics (
  github_id        bigint primary key references github_users on delete cascade,
  c_total          integer not null default 0,
  c_30             integer not null default 0,
  c_90             integer not null default 0,
  c_365            integer not null default 0,
  c_30_source      text not null default 'api' check (c_30_source in ('api','archive')),
  streak_current   integer not null default 0,
  streak_longest   integer not null default 0,
  last_active_on   date,
  stars_total      integer not null default 0,
  stars_approx     boolean not null default false,
  forks_total      integer not null default 0,
  followers        integer not null default 0,
  following        integer not null default 0,
  repos_public     integer not null default 0,
  lang_weights     jsonb not null default '{}',
  primary_language text,
  yearly_contrib   jsonb not null default '{}',
  calendar_52w     smallint[],
  prev_state       text,
  updated_at       timestamptz not null default now()
);
create index user_metrics_c_total on user_metrics (c_total desc);
create index user_metrics_c_30 on user_metrics (c_30 desc);
create index user_metrics_streak on user_metrics (streak_longest desc);
create index user_metrics_stars on user_metrics (stars_total desc);

create table repos (
  github_repo_id  bigint primary key,
  owner_id        bigint not null references github_users on delete cascade,
  name            text not null,
  description     text,
  stars           integer not null default 0,
  forks           integer not null default 0,
  primary_language text,
  language_color  text,
  releases_count  integer not null default 0,
  pushed_at       timestamptz,
  created_at_gh   timestamptz,
  is_archived     boolean not null default false,
  planet_slot     smallint check (planet_slot between 0 and 7),
  updated_at      timestamptz not null default now()
);
create index repos_owner_slot on repos (owner_id, planet_slot);

create table orgs (
  github_org_id bigint primary key,
  login citext not null unique,
  name text, avatar_url text
);
create table org_members (
  org_id bigint references orgs on delete cascade,
  github_id bigint references github_users on delete cascade,
  primary key (org_id, github_id)
);
create index org_members_user on org_members (github_id);

-- ─── Cosmos (written by the bake) ───────────────────────────────────
create table bake_runs (
  version      text primary key,
  status       text not null check (status in ('running','validated','live','failed','retired')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  stats        jsonb,
  params_hash  text not null
);

create table galaxies (
  id           smallint primary key,
  language     text not null unique,
  tier         text not null check (tier in ('major','minor','polyglot','void')),
  arms         smallint,
  radius       double precision not null,
  pitch        real,
  tilt         real[4],
  center       double precision[3] not null,
  population   integer not null,
  bake_version text not null references bake_runs
);

create table bodies (
  github_id     bigint primary key references github_users on delete cascade,
  bake_version  text not null,
  provisional   boolean not null default false,
  galaxy_id     smallint not null references galaxies,
  star_index    integer not null,
  x double precision not null, y double precision not null, z double precision not null,
  radius        real not null,
  base_radius   real not null,
  temperature   real not null,
  spectral_class char(1) not null,
  luminosity    real not null,
  impact        real not null,
  state         text not null check (state in ('protostar','main','red_giant','white_dwarf')),
  flags         integer not null default 0,
  rank_galaxy   integer, rank_global integer, pct_galaxy real
);
create index bodies_galaxy_rank on bodies (galaxy_id, rank_galaxy);
create index bodies_global_rank on bodies (rank_global);
create index bodies_impact on bodies (impact desc);
create index bodies_star_index on bodies (star_index);

create table rank_history (
  github_id    bigint references github_users on delete cascade,
  bake_version text,
  galaxy_id    smallint, rank_galaxy integer, pct_galaxy real,
  baked_at     timestamptz not null default now(),
  primary key (github_id, bake_version)
);

-- Small key/value store: current bake version, population context, delta etag.
create table universe_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ─── Accounts ───────────────────────────────────────────────────────
create table accounts (
  auth_user_id     uuid primary key references auth.users on delete cascade,
  github_id        bigint not null unique references github_users,
  role             text not null default 'user' check (role in ('user','admin')),
  claimed_at       timestamptz not null default now(),
  referral_code    text not null unique,
  bio_override     text check (char_length(bio_override) <= 160),
  pinned_override  bigint[] check (cardinality(pinned_override) <= 8),
  country          char(2),
  settings         jsonb not null default '{}',
  sync_token_enc   bytea,
  sync_token_nonce bytea,
  sync_token_kid   text,
  stardust_balance integer not null default 0 check (stardust_balance >= 0),
  beacon_last_at   timestamptz,
  beacon_language  text,
  onboarding_done  boolean not null default false,
  banned_at        timestamptz
);

create table beacon_tokens (
  id uuid primary key default gen_random_uuid(),
  github_id bigint not null references github_users on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table beacon_device_codes (
  device_code  text primary key,
  user_code    text not null unique,
  github_id    bigint references github_users on delete cascade,
  token        text,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

create table beacon_heartbeats (
  github_id  bigint not null references github_users on delete cascade,
  minute     timestamptz not null,
  language   text,
  primary key (github_id, minute)
);

-- ─── Economy ────────────────────────────────────────────────────────
create table items (
  id              text primary key,
  slot            text not null check (slot in ('corona','aura','star_rings','star_skin','planet_skin',
                                                'ship','trail','warp','banner','signal_style')),
  name            text not null,
  description     text not null default '',
  rarity          text not null check (rarity in ('common','rare','epic','legendary','mythic')),
  track           text not null check (track in ('earnable','premium','exclusive')),
  price_stardust  integer,
  price_minor     jsonb,
  available_from  timestamptz, available_until timestamptz,
  max_supply      integer,
  render_config   jsonb not null,
  active          boolean not null default true
);

create table orders (
  id                  uuid primary key default gen_random_uuid(),
  buyer_id            bigint not null references github_users,
  recipient_id        bigint not null references github_users,
  item_id             text not null references items,
  provider            text not null check (provider in ('stripe','paddle','mock')),
  provider_session_id text unique,
  idempotency_key     text not null unique,
  status              text not null check (status in ('pending','paid','refunded','failed','expired')),
  amount_minor        integer not null,
  currency            char(3) not null,
  created_at          timestamptz not null default now(),
  paid_at timestamptz, refunded_at timestamptz
);

create table inventory (
  id          uuid primary key default gen_random_uuid(),
  owner_id    bigint not null references github_users on delete cascade,
  item_id     text not null references items,
  source      text not null check (source in ('purchase','earn','gift','grant','achievement')),
  order_id    uuid references orders,
  acquired_at timestamptz not null default now(),
  revoked_at  timestamptz
);
create unique index inventory_one_per_item on inventory (owner_id, item_id) where revoked_at is null;

create table equipped (
  github_id    bigint references github_users on delete cascade,
  slot         text not null,
  inventory_id uuid not null references inventory on delete cascade,
  primary key (github_id, slot)
);

create table stardust_ledger (
  id         bigserial primary key,
  github_id  bigint not null references github_users on delete cascade,
  delta      integer not null,
  reason     text not null,
  ref_id     text not null,
  created_at timestamptz not null default now(),
  unique (github_id, reason, ref_id)
);

create table webhook_deliveries (
  provider     text not null,
  delivery_id  text not null,
  received_at  timestamptz not null default now(),
  attempts     integer not null default 1,
  last_error   text,
  processed_at timestamptz,
  primary key (provider, delivery_id)
);

-- Beacon Banner text (pre-moderated, §11.5)
create table banners (
  github_id  bigint primary key references github_users on delete cascade,
  text       text not null check (char_length(text) <= 24),
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

-- ─── Social ─────────────────────────────────────────────────────────
create table signals (
  id         bigserial primary key,
  from_id    bigint not null references github_users on delete cascade,
  to_id      bigint not null references github_users on delete cascade,
  message    text check (char_length(message) <= 60),
  sent_on    date not null default ((now() at time zone 'utc')::date),
  created_at timestamptz not null default now(),
  check (from_id <> to_id),
  unique (from_id, to_id, sent_on)
);
create index signals_to on signals (to_id, created_at desc);
create index signals_from_day on signals (from_id, sent_on);

create table blocks (
  blocker_id bigint not null references github_users on delete cascade,
  blocked_id bigint not null references github_users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table gifts (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null unique references orders,
  from_id    bigint not null references github_users,
  to_id      bigint not null references github_users,
  anonymous  boolean not null default false,
  state      text not null check (state in ('pending','delivered','opened','expired','refunded')),
  expires_at timestamptz not null,
  opened_at  timestamptz
);
create index gifts_to on gifts (to_id, state);

create table referrals (
  referee_id  bigint primary key references github_users,
  referrer_id bigint not null references github_users,
  clicked_at  timestamptz not null,
  claimed_at  timestamptz,
  verified_at timestamptz,
  rewarded    boolean not null default false,
  check (referee_id <> referrer_id)
);
create index referrals_referrer on referrals (referrer_id) where verified_at is not null;

create table bindings (
  id           uuid primary key default gen_random_uuid(),
  a_id         bigint not null references github_users,
  b_id         bigint not null references github_users,
  requested_by bigint not null,
  status       text not null check (status in ('pending','active','dissolved','declined')),
  created_at   timestamptz not null default now(),
  check (a_id < b_id)
);
create unique index bindings_pair_open on bindings (a_id, b_id) where status in ('pending','active');

create function bindings_one_active() returns trigger language plpgsql as $$
begin
  if new.status = 'active' and exists (
    select 1 from bindings b
    where b.status = 'active' and b.id <> new.id
      and (b.a_id in (new.a_id, new.b_id) or b.b_id in (new.a_id, new.b_id))
  ) then
    raise exception 'binary_limit: each user can have one active binary' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger bindings_one_active before insert or update on bindings
  for each row execute function bindings_one_active();

create table achievements (
  id text primary key, name text not null, tier text not null,
  description text not null, stardust_reward integer not null default 0, hidden boolean default false
);
create table user_achievements (
  github_id bigint references github_users on delete cascade,
  achievement_id text references achievements,
  unlocked_at timestamptz not null default now(),
  primary key (github_id, achievement_id)
);
create index user_achievements_by_achievement on user_achievements (achievement_id);

create table events (
  id         bigserial,
  type       text not null,
  actor_id   bigint,
  target_id  bigint,
  payload    jsonb not null default '{}',
  visibility text not null default 'public',
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
create table events_default partition of events default;
create index events_public_recent on events (created_at desc) where visibility = 'public';
create index events_actor on events (actor_id, type, created_at desc);

-- Monthly partitions: the worker calls this daily; partitions older than 12 months are dropped.
create function ensure_event_partitions(months_ahead int default 2) returns void language plpgsql as $$
declare
  m date := date_trunc('month', now() at time zone 'utc')::date;
  i int;
  start_d date; end_d date; pname text;
begin
  for i in 0..months_ahead loop
    start_d := (m + make_interval(months => i))::date;
    end_d := (m + make_interval(months => i + 1))::date;
    pname := 'events_' || to_char(start_d, 'YYYYMM');
    if not exists (select 1 from pg_class where relname = pname) then
      execute format('create table %I partition of events for values from (%L) to (%L)', pname, start_d, end_d);
    end if;
  end loop;
end $$;
select ensure_event_partitions(2);

create table notifications (
  id bigserial primary key,
  recipient_id bigint not null references github_users on delete cascade,
  type text not null, payload jsonb not null,
  read_at timestamptz, created_at timestamptz not null default now()
);
create index notifications_unread on notifications (recipient_id, created_at desc) where read_at is null;

create table shared_views (
  id text primary key,
  camera jsonb not null,
  bake_version text not null,
  created_by bigint, created_at timestamptz not null default now()
);

-- Explorer stats for Voyager / Cartographer / Hyperspace / Eyewitness / Comet Chaser / check-ins
create table explorer_stats (
  github_id         bigint primary key references github_users on delete cascade,
  warps             integer not null default 0,
  galaxies_visited  text[] not null default '{}',
  eyewitness        boolean not null default false,
  comet_chased      boolean not null default false,
  last_checkin_on   date,
  checkin_streak    integer not null default 0
);
create table visits (
  github_id bigint not null references github_users on delete cascade,
  star_id   bigint not null,
  primary key (github_id, star_id)
);

-- Materialize job status (F2); pg-boss carries the work, this row carries the user-visible status.
create table materialize_jobs (
  id         uuid primary key default gen_random_uuid(),
  login      citext not null,
  status     text not null default 'queued' check (status in ('queued','fetching','placing','born','failed')),
  github_id  bigint,
  error      text,
  priority   integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index materialize_jobs_open on materialize_jobs (created_at) where status in ('queued','fetching','placing');
create unique index materialize_jobs_one_open_per_login on materialize_jobs (login) where status in ('queued','fetching','placing');

-- Events API polling state (F10)
create table poll_state (
  github_id    bigint primary key references github_users on delete cascade,
  etag         text,
  last_event_id text,
  interval_s   integer not null default 120,
  next_poll_at timestamptz not null default now()
);

-- Scheduled cosmic events (meteor showers) — F17
create table cosmic_events (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('meteor_shower','census')),
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  payload    jsonb not null default '{}',
  check (ends_at > starts_at)
);

-- Local kill switches / flags (PostHog flags take precedence when configured)
create table feature_flags (
  key        text primary key,
  enabled    boolean not null,
  updated_at timestamptz not null default now()
);

-- ─── Trust & Safety ─────────────────────────────────────────────────
create table reports (
  id bigserial primary key, reporter_id bigint, target_type text not null,
  target_id text not null, reason text not null,
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now()
);
create table admin_audit_log (
  id bigserial primary key, admin_id bigint not null, action text not null,
  target text, before jsonb, after jsonb, created_at timestamptz not null default now()
);

-- Append-only guards
create function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger admin_audit_log_append_only before update or delete on admin_audit_log
  for each row execute function forbid_mutation();
create trigger stardust_ledger_append_only before update or delete on stardust_ledger
  for each row execute function forbid_mutation();

-- Ledger → materialized balance. The accounts CHECK (stardust_balance >= 0) makes an overdraft fail the insert.
create function stardust_apply() returns trigger language plpgsql as $$
begin
  update accounts set stardust_balance = stardust_balance + new.delta where github_id = new.github_id;
  if not found then
    raise exception 'stardust ledger requires a claimed account (github_id %)', new.github_id;
  end if;
  return new;
end $$;
create trigger stardust_apply after insert on stardust_ledger
  for each row execute function stardust_apply();

-- ─── Row Level Security (§9.1) ─────────────────────────────────────
alter table accounts enable row level security;
create policy "own account read" on accounts for select using (auth.uid() = auth_user_id);

alter table notifications enable row level security;
create policy "own notifications" on notifications for select
  using (recipient_id = (select github_id from accounts where auth_user_id = auth.uid()));

alter table orders enable row level security;
create policy "own orders" on orders for select
  using (buyer_id = (select github_id from accounts where auth_user_id = auth.uid()));

-- Every other table: RLS on, no policies → service role only.
do $$
declare t text;
begin
  foreach t in array array['github_users','login_aliases','user_metrics','repos','orgs','org_members','bake_runs','galaxies',
    'bodies','rank_history','universe_state','beacon_tokens','beacon_device_codes','beacon_heartbeats','items','inventory',
    'equipped','stardust_ledger','webhook_deliveries','banners','signals','blocks','gifts','referrals','bindings',
    'achievements','user_achievements','events','notifications','shared_views','explorer_stats','visits',
    'materialize_jobs','poll_state','cosmic_events','feature_flags','reports','admin_audit_log']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Public cosmos reads go through a view that hides opted-out users:
create view public_stars with (security_invoker = true) as
  select b.*, u.login, u.name, u.avatar_url
  from bodies b join github_users u using (github_id)
  where not u.is_opted_out;

-- Supabase Realtime: stream notifications to their owners (postgres_changes + RLS)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table notifications';
  end if;
end $$;

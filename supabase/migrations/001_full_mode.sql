-- Newsjack Web Full Mode schema (Supabase / Postgres)

create extension if not exists "pgcrypto";

-- Orgs (optional multi-tenant; single-user installs use one org)
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid references public.orgs (id) on delete set null,
  display_name text,
  created_at timestamptz not null default now()
);

-- Client profiles (PR standing) — durable equivalent of local ~/.newsjack profiles
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  slug text not null,
  name text not null,
  standing text default '',
  beats text default '',
  competitors text default '',
  spokespeople text default '',
  proof_assets text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

-- Saved monitors (newsjack-monitor-setup)
create table if not exists public.monitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  slug text not null,
  title text not null,
  topics text[] not null default '{}',
  feeds text[] not null default '{}',
  schedule_cron text not null default '0 9 * * *',
  slack_webhook_secret_id uuid,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

-- Coverage keyword trackers
create table if not exists public.coverage_trackers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  keywords jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seen-state for detector / tracker (dedupe)
create table if not exists public.seen_signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  monitor_id uuid references public.monitors (id) on delete cascade,
  fingerprint text not null,
  title text,
  url text,
  first_public_at timestamptz,
  seen_at timestamptz not null default now(),
  unique (org_id, fingerprint)
);

create index if not exists seen_signals_monitor_idx on public.seen_signals (monitor_id, seen_at desc);

-- Skill / detector / browser jobs
create type public.job_kind as enum (
  'skill_run',
  'detector_run',
  'coverage_scan',
  'press_clip',
  'coverage_reel'
);

create type public.job_status as enum (
  'queued',
  'running',
  'waiting_manus',
  'completed',
  'failed',
  'cancelled'
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  monitor_id uuid references public.monitors (id) on delete set null,
  kind public.job_kind not null,
  skill_slug text,
  status public.job_status not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  output_text text,
  error text,
  -- Manus browser worker
  manus_task_id text,
  manus_task_url text,
  manus_event_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists jobs_org_status_idx on public.jobs (org_id, status, created_at desc);
create index if not exists jobs_manus_task_idx on public.jobs (manus_task_id) where manus_task_id is not null;

-- Artifacts (PDFs, reels, reports) — metadata; bytes in Storage
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  kind text not null,
  storage_path text,
  external_url text,
  mime_type text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Encrypted-ish secrets store (use pgsodium / vault in production)
create table if not exists public.secrets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  value_ciphertext text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

drop trigger if exists jobs_updated_at on public.jobs;
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- RLS (enable; policies assume auth.uid() → profiles.org_id)
alter table public.orgs enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.monitors enable row level security;
alter table public.coverage_trackers enable row level security;
alter table public.seen_signals enable row level security;
alter table public.jobs enable row level security;
alter table public.artifacts enable row level security;
alter table public.secrets enable row level security;

-- Service role bypasses RLS for webhooks / cron

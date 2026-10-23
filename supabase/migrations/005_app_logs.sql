-- Debug traces for LLM + external API calls
create table if not exists public.app_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs (id) on delete set null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  source text not null default 'app',
  kind text not null default 'event',
  message text not null default '',
  request jsonb default '{}'::jsonb,
  response jsonb default '{}'::jsonb,
  meta jsonb default '{}'::jsonb,
  duration_ms integer,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists app_logs_created on public.app_logs (created_at desc);
create index if not exists app_logs_kind on public.app_logs (kind, created_at desc);
create index if not exists app_logs_source on public.app_logs (source, created_at desc);

alter table public.app_logs enable row level security;

drop policy if exists app_logs_member on public.app_logs;
create policy app_logs_member on public.app_logs
  for all using (
    org_id is null or org_id in (select public.user_org_ids())
  )
  with check (
    org_id is null or org_id in (select public.user_org_ids())
  );

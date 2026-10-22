-- Durable app state: settings, client profile, chat, skill drafts fix

-- App-wide provider settings (API keys, endpoints) per org
create table if not exists public.app_settings (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Single active client profile per org (mirrors /profile page)
create table if not exists public.client_profiles (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  name text not null default '',
  standing text not null default '',
  beats text not null default '',
  competitors text not null default '',
  notes text not null default '',
  website text default '',
  updated_at timestamptz not null default now()
);

-- Chat threads
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  title text not null default 'New chat',
  skill_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_threads_org_updated
  on public.chat_threads (org_id, updated_at desc);

-- Chat messages
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  skill_slug text,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_thread
  on public.chat_messages (thread_id, created_at);

-- Skill form drafts: rename values -> payload if table exists with values
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'skill_drafts' and column_name = 'values'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'skill_drafts' and column_name = 'payload'
  ) then
    alter table public.skill_drafts rename column "values" to payload;
  end if;
end $$;

create table if not exists public.skill_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  skill_slug text not null,
  title text,
  payload jsonb not null default '{}'::jsonb,
  profile_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, skill_slug)
);

-- RLS
alter table public.app_settings enable row level security;
alter table public.client_profiles enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.skill_drafts enable row level security;

drop policy if exists app_settings_member on public.app_settings;
create policy app_settings_member on public.app_settings
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

drop policy if exists client_profiles_member on public.client_profiles;
create policy client_profiles_member on public.client_profiles
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

drop policy if exists chat_threads_member on public.chat_threads;
create policy chat_threads_member on public.chat_threads
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

drop policy if exists chat_messages_member on public.chat_messages;
create policy chat_messages_member on public.chat_messages
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

drop policy if exists skill_drafts_all_member on public.skill_drafts;
create policy skill_drafts_all_member on public.skill_drafts
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- Saved skill form drafts per user/org
create table if not exists public.skill_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  skill_slug text not null,
  title text,
  values jsonb not null default '{}'::jsonb,
  profile_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, skill_slug)
);

create index if not exists skill_drafts_org_slug on public.skill_drafts (org_id, skill_slug);

alter table public.skill_drafts enable row level security;

drop policy if exists skill_drafts_all_member on public.skill_drafts;
create policy skill_drafts_all_member on public.skill_drafts
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

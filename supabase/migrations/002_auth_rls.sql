-- Auth + RLS for multi-user orgs
-- Assumes auth.users from Supabase Auth

-- Helper: org ids for current user
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid() and org_id is not null;
$$;

-- Auto-create profile on signup (optional trigger)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
begin
  insert into public.orgs (name)
  values (coalesce(new.raw_user_meta_data->>'org_name', split_part(new.email, '@', 1) || '''s org'))
  returning id into new_org;

  insert into public.profiles (id, org_id, display_name)
  values (
    new.id,
    new_org,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid());

-- Orgs: members can read their org
drop policy if exists orgs_select_member on public.orgs;
create policy orgs_select_member on public.orgs
  for select using (id in (select public.user_org_ids()));

-- Clients
drop policy if exists clients_all_member on public.clients;
create policy clients_all_member on public.clients
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- Monitors
drop policy if exists monitors_all_member on public.monitors;
create policy monitors_all_member on public.monitors
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- Coverage trackers
drop policy if exists coverage_trackers_all_member on public.coverage_trackers;
create policy coverage_trackers_all_member on public.coverage_trackers
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- Seen signals
drop policy if exists seen_signals_all_member on public.seen_signals;
create policy seen_signals_all_member on public.seen_signals
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- Jobs
drop policy if exists jobs_all_member on public.jobs;
create policy jobs_all_member on public.jobs
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- Artifacts
drop policy if exists artifacts_all_member on public.artifacts;
create policy artifacts_all_member on public.artifacts
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- Secrets: members can manage (values should be app-encrypted)
drop policy if exists secrets_all_member on public.secrets;
create policy secrets_all_member on public.secrets
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- Storage bucket for artifacts (run in dashboard or via API)
-- insert into storage.buckets (id, name, public) values ('newsjack-artifacts', 'newsjack-artifacts', false);

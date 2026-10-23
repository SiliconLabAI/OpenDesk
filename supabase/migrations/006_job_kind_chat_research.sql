-- Allow chat Manus research jobs
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'job_kind' and e.enumlabel = 'chat_research'
  ) then
    alter type public.job_kind add value 'chat_research';
  end if;
end $$;

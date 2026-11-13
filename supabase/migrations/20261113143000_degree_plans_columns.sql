-- Better OTU — Add degree_name & start_year to degree_plans and place
-- user_email first and degree_name second for easier inspection in Supabase.
--
-- Backwards-compatible with `main` (existing columns, constraints, indexes,
-- triggers, grants, and RLS policies are preserved).

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'degree_plans'
      and column_name = 'user_email'
      and ordinal_position = 1
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'degree_plans'
      and column_name = 'degree_name'
      and ordinal_position = 2
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'degree_plans'
      and column_name = 'start_year'
  ) then
    return;
  end if;

  create table public.degree_plans_new (
    user_email  text not null,
    degree_name text,
    start_year  integer,
    program_id  text not null,
    terms       jsonb not null default '[]'::jsonb,
    customs     jsonb not null default '[]'::jsonb,
    user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
    id          uuid primary key default gen_random_uuid(),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
  );

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'degree_plans'
  ) then
    insert into public.degree_plans_new (
      user_email,
      degree_name,
      start_year,
      program_id,
      terms,
      customs,
      user_id,
      id,
      created_at,
      updated_at
    )
    select
      user_email,
      null::text,
      null::integer,
      program_id,
      terms,
      customs,
      user_id,
      id,
      created_at,
      updated_at
    from public.degree_plans;

    drop table public.degree_plans;
  end if;

  alter table public.degree_plans_new rename to degree_plans;
  alter table public.degree_plans
    add constraint degree_plans_user_email_program_key unique (user_email, program_id);
end;
$$;

create index if not exists degree_plans_user_email_updated_idx
  on public.degree_plans (user_email, updated_at desc);

drop trigger if exists degree_plans_set_updated_at on public.degree_plans;
create trigger degree_plans_set_updated_at
  before update on public.degree_plans
  for each row
  execute function public.set_updated_at();

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.degree_plans to authenticated;
grant all on public.degree_plans to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table public.degree_plans enable row level security;

drop policy if exists "Students can view their own degree plans" on public.degree_plans;
create policy "Students can view their own degree plans"
  on public.degree_plans
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and lower(user_email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

drop policy if exists "Students can insert their own degree plans" on public.degree_plans;
create policy "Students can insert their own degree plans"
  on public.degree_plans
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and lower(user_email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

drop policy if exists "Students can update their own degree plans" on public.degree_plans;
create policy "Students can update their own degree plans"
  on public.degree_plans
  for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and lower(user_email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  )
  with check (
    (select auth.uid()) = user_id
    and lower(user_email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

drop policy if exists "Students can delete their own degree plans" on public.degree_plans;
create policy "Students can delete their own degree plans"
  on public.degree_plans
  for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and lower(user_email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

notify pgrst, 'reload schema';
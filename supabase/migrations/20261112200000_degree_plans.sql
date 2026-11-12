-- Better OTU — Per-user Degree Planner persistence keyed by student email.
--
-- Apply after:
--   1. 20261028000000_baseline_courses_schema.sql
--   2. 20261028120000_search_optimizations.sql
--   3. 20261112000000_campus_map_schema.sql
--   4. 20261112120000_degree_planner_schema.sql
--   5. 20261112180000_auth_and_student_courses.sql
--   6. 20261112200000_degree_plans.sql  <- this file

create table if not exists public.degree_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_email  text not null,
  program_id  text not null,
  terms       jsonb not null default '[]'::jsonb,
  customs     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint degree_plans_user_email_program_key unique (user_email, program_id)
);

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

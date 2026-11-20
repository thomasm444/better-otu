-- Better OTU — Student onboarding fields on public.profiles linked to degree_programs.
--
-- Apply after:
--   20261120000000_degree_plans_minor.sql
--
-- Every statement is idempotent so re-running is safe.

alter table public.profiles
  add column if not exists year_of_study smallint,
  add column if not exists degree_program_id text,
  add column if not exists has_minor boolean,
  add column if not exists minor_program_id text,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists onboarding_skipped_at timestamptz;

comment on column public.profiles.year_of_study is
  '1 = Year 1, 2 = Year 2, 3 = Year 3, 4 = Year 4+';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_year_of_study_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_year_of_study_check
      check (year_of_study between 1 and 4);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_degree_program_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_degree_program_id_fkey
      foreign key (degree_program_id)
      references public.degree_programs (program_id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_minor_program_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_minor_program_id_fkey
      foreign key (minor_program_id)
      references public.degree_programs (program_id)
      on delete set null;
  end if;
end;
$$;

create index if not exists profiles_degree_program_id_idx
  on public.profiles (degree_program_id);

create index if not exists profiles_minor_program_id_idx
  on public.profiles (minor_program_id);

-- Backfill any existing auth.users rows that do not yet have a profile row.
insert into public.profiles (id, email, full_name, avatar_url)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
  coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;

grant select, insert, update on public.profiles to authenticated;

drop policy if exists "Students can insert their own profile" on public.profiles;
create policy "Students can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

notify pgrst, 'reload schema';

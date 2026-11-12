-- Better OTU — Google OAuth domain restriction, student profiles, and per-user course tracking.
--
-- Apply after:
--   1. 20261028000000_baseline_courses_schema.sql
--   2. 20261028120000_search_optimizations.sql
--   3. 20261112000000_campus_map_schema.sql
--   4. 20261112120000_degree_planner_schema.sql
--   5. 20261112180000_auth_and_student_courses.sql  <- this file
--
-- After running this migration, enable `public.hook_before_user_created` under:
--   Supabase Dashboard -> Authentication -> Hooks -> Before User Created

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Before User Created Auth Hook
--
-- Rejects any sign-up whose email does not belong to @ontariotechu.net.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text;
begin
  user_email := lower(trim(coalesce(event -> 'user' ->> 'email', '')));

  if user_email = '' or user_email !~ '^[^@\s]+@ontariotechu\.net$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Access restricted to @ontariotechu.net Google accounts.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Shared updated_at trigger helper
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Student profiles (1:1 with auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Auto-populate profiles from Google OAuth metadata on first login.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(excluded.full_name, public.profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Student courses & academic progress
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.student_courses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_code  text not null,
  selected_crn text,
  semester     text not null,
  status       text not null default 'planned'
               check (status in ('planned', 'enrolled', 'in_progress', 'completed', 'dropped')),
  grade        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint student_courses_user_course_semester_key unique (user_id, course_code, semester)
);

create index if not exists student_courses_user_semester_idx
  on public.student_courses (user_id, semester);

drop trigger if exists student_courses_set_updated_at on public.student_courses;
create trigger student_courses_set_updated_at
  before update on public.student_courses
  for each row
  execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Privileges & Row Level Security (RLS)
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.student_courses to authenticated;
grant all on public.profiles, public.student_courses to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.student_courses enable row level security;

-- profiles policies
drop policy if exists "Students can view their own profile" on public.profiles;
create policy "Students can view their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Students can update their own profile" on public.profiles;
create policy "Students can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- student_courses policies
drop policy if exists "Students can view their own courses" on public.student_courses;
create policy "Students can view their own courses"
  on public.student_courses
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Students can insert their own courses" on public.student_courses;
create policy "Students can insert their own courses"
  on public.student_courses
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Students can update their own courses" on public.student_courses;
create policy "Students can update their own courses"
  on public.student_courses
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Students can delete their own courses" on public.student_courses;
create policy "Students can delete their own courses"
  on public.student_courses
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';

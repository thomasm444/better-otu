-- Better OTU — RateMyProfessors Schema & Professor Table Links
--
-- Adds:
--   1. public.rmp_professors: matched Ontario Tech RMP profiles (match_score > 80.0)
--      with overall rating, difficulty, would-take-again %, and 1-5 distribution.
--   2. public.rmp_professor_courses: per-(professor, course) breakdown for dynamic
--      course-dropdown updates, linked to public.catalog_courses when applicable.
--   3. rmp_professor_id foreign keys + auto-link triggers/refresh helper on all
--      professor-bearing tables (public.course_faculty and public.exam_schedules).
--
-- Apply after 20261119000000_campus_map_week_indexes.sql.
-- Every statement is idempotent so re-running is safe.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. rmp_professors — RateMyProfessors profiles matched to Ontario Tech faculty
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.rmp_professors (
  id                       text primary key,
  legacy_id                integer unique,
  first_name               text not null,
  last_name                text not null,
  full_name                text not null,
  department               text,
  department_id            text,
  best_match_display_name  text,
  matched_display_names    text[] not null default '{}',
  match_score              numeric(5, 2) not null check (match_score > 80.0),
  avg_rating               numeric(3, 2),
  avg_difficulty           numeric(3, 2),
  num_ratings              integer not null default 0,
  would_take_again_percent numeric(5, 2),
  would_take_again_count   integer not null default 0,
  r1                       integer not null default 0,
  r2                       integer not null default 0,
  r3                       integer not null default 0,
  r4                       integer not null default 0,
  r5                       integer not null default 0,
  updated_at               timestamptz not null default now()
);

create index if not exists rmp_professors_best_match_name_idx
  on public.rmp_professors (best_match_display_name);

create index if not exists rmp_professors_matched_names_gin_idx
  on public.rmp_professors using gin (matched_display_names);

create index if not exists rmp_professors_last_name_idx
  on public.rmp_professors (lower(last_name));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. rmp_professor_courses — per-course rating breakdown for each matched prof
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.rmp_professor_courses (
  id                       bigint generated always as identity primary key,
  professor_id             text not null references public.rmp_professors (id) on delete cascade,
  course_code              text not null,
  subject_course           text not null,
  course_title             text,
  catalog_course_code      text references public.catalog_courses (code) on update cascade on delete set null,
  raw_course_codes         text[] not null default '{}',
  taught_in_banner         boolean not null default false,
  terms_taught             text[] not null default '{}',
  avg_rating               numeric(3, 2),
  avg_difficulty           numeric(3, 2),
  num_ratings              integer not null default 0,
  would_take_again_percent numeric(5, 2),
  would_take_again_count   integer not null default 0,
  r1                       integer not null default 0,
  r2                       integer not null default 0,
  r3                       integer not null default 0,
  r4                       integer not null default 0,
  r5                       integer not null default 0,
  updated_at               timestamptz not null default now(),
  unique (professor_id, course_code)
);

create index if not exists rmp_professor_courses_prof_idx
  on public.rmp_professor_courses (professor_id);

create index if not exists rmp_professor_courses_subject_course_idx
  on public.rmp_professor_courses (subject_course, professor_id);

create index if not exists rmp_professor_courses_catalog_idx
  on public.rmp_professor_courses (catalog_course_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Connect professor-bearing tables (course_faculty, exam_schedules)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.course_faculty
  add column if not exists rmp_professor_id text references public.rmp_professors (id) on delete set null;

create index if not exists course_faculty_rmp_professor_idx
  on public.course_faculty (rmp_professor_id);

alter table public.exam_schedules
  add column if not exists rmp_professor_id text references public.rmp_professors (id) on delete set null;

create index if not exists exam_schedules_rmp_professor_idx
  on public.exam_schedules (rmp_professor_id);

-- Speeds up CRN lookups from exam_schedules -> courses -> course_faculty
create index if not exists courses_crn_idx
  on public.courses (crn);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Resolution helpers, triggers, and bulk link refresh RPC
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.resolve_course_faculty_rmp_professor_id(p_display_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select p.id
  from public.rmp_professors p
  where p_display_name is not null
    and p.matched_display_names @> array[p_display_name]
  order by p.match_score desc, p.num_ratings desc, p.id asc
  limit 1;
$$;

create or replace function public.resolve_exam_rmp_professor_id(
  p_crn text,
  p_subject_code text,
  p_course_code text,
  p_instructor text,
  p_term_year integer,
  p_term_season text
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_term text;
  v_prof_id text;
  v_inst text;
begin
  v_inst := nullif(trim(coalesce(p_instructor, '')), '');

  if p_term_year is not null and p_term_season is not null then
    v_term := p_term_year::text || case lower(trim(p_term_season))
      when 'winter' then '01'
      when 'summer' then '05'
      when 'fall'   then '09'
      else ''
    end;
    if length(v_term) <> 6 then
      v_term := null;
    end if;
  end if;

  -- 1. Match via Banner section CRN (preferring matching term + matching surname)
  if nullif(trim(coalesce(p_crn, '')), '') is not null then
    select coalesce(
      cf.rmp_professor_id,
      public.resolve_course_faculty_rmp_professor_id(cf.display_name)
    )
    into v_prof_id
    from public.courses c
    join public.course_faculty cf on cf.course_id = c.id
    where c.crn = trim(p_crn)
      and (p_subject_code is null or c.subject = trim(p_subject_code))
      and (p_course_code is null or c.course_number = trim(p_course_code))
      and coalesce(
        cf.rmp_professor_id,
        public.resolve_course_faculty_rmp_professor_id(cf.display_name)
      ) is not null
    order by
      (v_term is not null and c.term = v_term) desc,
      (v_inst is not null and lower(trim(split_part(cf.display_name, ',', 1))) = lower(v_inst)) desc,
      c.term desc,
      cf.primary_indicator desc
    limit 1;

    if v_prof_id is not null then
      return v_prof_id;
    end if;
  end if;

  -- 2. Match via course code + instructor surname in course_faculty
  if v_inst is not null and p_subject_code is not null and p_course_code is not null then
    select coalesce(
      cf.rmp_professor_id,
      public.resolve_course_faculty_rmp_professor_id(cf.display_name)
    )
    into v_prof_id
    from public.courses c
    join public.course_faculty cf on cf.course_id = c.id
    where c.subject = trim(p_subject_code)
      and c.course_number = trim(p_course_code)
      and lower(trim(split_part(cf.display_name, ',', 1))) = lower(v_inst)
      and coalesce(
        cf.rmp_professor_id,
        public.resolve_course_faculty_rmp_professor_id(cf.display_name)
      ) is not null
    order by
      (v_term is not null and c.term = v_term) desc,
      c.term desc,
      cf.primary_indicator desc
    limit 1;

    if v_prof_id is not null then
      return v_prof_id;
    end if;
  end if;

  -- 3. Fallback: unambiguous last-name match in rmp_professors
  if v_inst is not null then
    select min(p.id)
    into v_prof_id
    from public.rmp_professors p
    where lower(trim(p.last_name)) = lower(v_inst)
    having count(*) = 1;

    if v_prof_id is not null then
      return v_prof_id;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.link_course_faculty_rmp_professor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.display_name is null then
    new.rmp_professor_id := null;
  elsif new.rmp_professor_id is null
     or (tg_op = 'UPDATE' and new.display_name is distinct from old.display_name) then
    new.rmp_professor_id := public.resolve_course_faculty_rmp_professor_id(new.display_name);
  end if;
  return new;
end;
$$;

drop trigger if exists course_faculty_link_rmp_professor on public.course_faculty;
create trigger course_faculty_link_rmp_professor
  before insert or update of display_name on public.course_faculty
  for each row
  execute function public.link_course_faculty_rmp_professor();

create or replace function public.link_exam_schedules_rmp_professor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rmp_professor_id is null
     or (
       tg_op = 'UPDATE' and (
         new.crn is distinct from old.crn
         or new.instructor is distinct from old.instructor
         or new.subject_code is distinct from old.subject_code
         or new.course_code is distinct from old.course_code
         or new.term_year is distinct from old.term_year
         or new.term_season is distinct from old.term_season
       )
     ) then
    new.rmp_professor_id := public.resolve_exam_rmp_professor_id(
      new.crn,
      new.subject_code,
      new.course_code,
      new.instructor,
      new.term_year,
      new.term_season
    );
  end if;
  return new;
end;
$$;

drop trigger if exists exam_schedules_link_rmp_professor on public.exam_schedules;
create trigger exam_schedules_link_rmp_professor
  before insert or update of crn, instructor, subject_code, course_code, term_year, term_season
  on public.exam_schedules
  for each row
  execute function public.link_exam_schedules_rmp_professor();

create or replace function public.refresh_rmp_professor_links()
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
begin
  with name_map as (
    select distinct on (d.display_name)
      d.display_name,
      p.id as new_rmp_id
    from public.rmp_professors p
    cross join lateral unnest(p.matched_display_names) as d(display_name)
    order by d.display_name, p.match_score desc, p.num_ratings desc, p.id asc
  )
  update public.course_faculty cf
  set rmp_professor_id = nm.new_rmp_id
  from name_map nm
  where cf.display_name = nm.display_name
    and cf.rmp_professor_id is distinct from nm.new_rmp_id;

  update public.course_faculty cf
  set rmp_professor_id = null
  where cf.rmp_professor_id is not null
    and (
      cf.display_name is null
      or not exists (
        select 1
        from public.rmp_professors p
        where p.matched_display_names @> array[cf.display_name]
      )
    );

  with resolved_exams as (
    select
      es.id,
      public.resolve_exam_rmp_professor_id(
        es.crn,
        es.subject_code,
        es.course_code,
        es.instructor,
        es.term_year,
        es.term_season
      ) as new_rmp_id
    from public.exam_schedules es
  )
  update public.exam_schedules es
  set rmp_professor_id = r.new_rmp_id
  from resolved_exams r
  where es.id = r.id
    and es.rmp_professor_id is distinct from r.new_rmp_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Privileges & Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

grant select on public.rmp_professors, public.rmp_professor_courses
  to anon, authenticated;

grant select, insert, update, delete on public.rmp_professors, public.rmp_professor_courses
  to service_role;

grant usage, select on all sequences in schema public to service_role;

grant execute on function public.resolve_course_faculty_rmp_professor_id(text)
  to anon, authenticated, service_role;
grant execute on function public.resolve_exam_rmp_professor_id(text, text, text, text, integer, text)
  to anon, authenticated, service_role;
grant execute on function public.refresh_rmp_professor_links()
  to service_role;

alter table public.rmp_professors enable row level security;
alter table public.rmp_professor_courses enable row level security;

drop policy if exists "rmp_professors are publicly readable" on public.rmp_professors;
create policy "rmp_professors are publicly readable"
  on public.rmp_professors
  for select
  to anon, authenticated
  using (true);

drop policy if exists "rmp_professor_courses are publicly readable" on public.rmp_professor_courses;
create policy "rmp_professor_courses are publicly readable"
  on public.rmp_professor_courses
  for select
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';

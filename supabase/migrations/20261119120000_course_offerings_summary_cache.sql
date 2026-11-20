-- Better OTU — Precomputed course_offerings_summary cache & Degree Planner indexes
--
-- Eliminates cold-start statement timeouts (Supabase anon 3s default) in
-- getCourseOfferings(), getCatalogCourses(), and getProgramSummaries() by
-- replacing the live GROUP BY over public.courses with a PK-indexed cache table
-- + atomic refresh RPC, and adding a matching composite index on degree_programs.
--
-- Apply after 20261119000000_campus_map_week_indexes.sql.
-- Every statement is idempotent so re-running is safe.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Precomputed cache table backing public.course_offerings_summary
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.course_offerings_summary_cache (
  subject_course text primary key,
  subject        text not null,
  course_number  text not null,
  terms          text[] not null default '{}',
  sections       integer not null default 0,
  credit_hours   numeric,
  updated_at     timestamptz not null default now()
);

grant select on public.course_offerings_summary_cache to anon, authenticated, service_role;
grant select, insert, update, delete on public.course_offerings_summary_cache to service_role;

alter table public.course_offerings_summary_cache enable row level security;

drop policy if exists "course_offerings_summary_cache is publicly readable"
  on public.course_offerings_summary_cache;
create policy "course_offerings_summary_cache is publicly readable"
  on public.course_offerings_summary_cache
  for select
  to anon, authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Supporting indexes for fast refreshes and Degree Planner bootstrap queries
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists courses_offerings_summary_idx
  on public.courses ((coalesce(nullif(subject_course, ''), subject || course_number)), term_desc)
  where subject is not null and course_number is not null;

create index if not exists degree_programs_catalog_year_desc_name_idx
  on public.degree_programs (catalog_year desc, name asc, program_id asc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Atomic refresh function (call after Banner course ingestion)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.refresh_course_offerings_summary()
returns integer
language plpgsql
set search_path = public
as $$
declare
  row_count integer;
begin
  create temp table _course_offerings_next on commit drop as
  select
    coalesce(nullif(subject_course, ''), subject || course_number) as subject_course,
    min(subject) as subject,
    min(course_number) as course_number,
    coalesce(
      array_agg(distinct term_desc order by term_desc) filter (where term_desc is not null),
      '{}'::text[]
    ) as terms,
    count(*)::integer as sections,
    max(credit_hours)::numeric as credit_hours
  from public.courses
  where subject is not null and course_number is not null
  group by coalesce(nullif(subject_course, ''), subject || course_number);

  insert into public.course_offerings_summary_cache (
    subject_course,
    subject,
    course_number,
    terms,
    sections,
    credit_hours,
    updated_at
  )
  select
    subject_course,
    subject,
    course_number,
    terms,
    sections,
    credit_hours,
    now()
  from _course_offerings_next
  on conflict (subject_course) do update
    set subject       = excluded.subject,
        course_number = excluded.course_number,
        terms         = excluded.terms,
        sections      = excluded.sections,
        credit_hours  = excluded.credit_hours,
        updated_at    = excluded.updated_at;

  delete from public.course_offerings_summary_cache c
  where not exists (
    select 1
    from _course_offerings_next n
    where n.subject_course = c.subject_course
  );

  select count(*)::integer into row_count
  from public.course_offerings_summary_cache;

  return row_count;
end;
$$;

revoke all on function public.refresh_course_offerings_summary() from public;
grant execute on function public.refresh_course_offerings_summary() to service_role;

-- Populate immediately during migration
select public.refresh_course_offerings_summary();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Point public.course_offerings_summary view at the cache table
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.course_offerings_summary
with (security_invoker = true)
as
select
  subject_course,
  subject,
  course_number,
  terms,
  sections,
  credit_hours::numeric as credit_hours
from public.course_offerings_summary_cache;

grant select on public.course_offerings_summary to anon, authenticated, service_role;

analyze public.course_offerings_summary_cache;
analyze public.degree_programs;
analyze public.catalog_courses;

notify pgrst, 'reload schema';

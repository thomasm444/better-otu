-- Better OTU — search optimisation + data repair
--
-- Apply AFTER 20261028000000_baseline_courses_schema.sql. Every statement is
-- idempotent (IF NOT EXISTS / idempotent REPLACE), so re-running is safe.
--
-- Measured on 2026-10-28 for the current data set:
--   4,024 course sections (2,060 in 202609, 1,964 in 202701)
--   1,943 course_faculty rows
--   9,083 course_meetings rows

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Data repair: HTML entities left behind by the Banner scrape
--
-- Counts observed in public.courses: "&amp;" x704, "&#39;" x17, "&ndash;" x1.
-- These render literally in the UI ("Lecture &amp; Lab"). The ingest script now
-- runs html.unescape() on every text value, so this only needs to run once.
-- ─────────────────────────────────────────────────────────────────────────────
begin;

update public.courses
   set course_title = replace(
                        replace(
                          replace(course_title, '&amp;', '&'),
                          '&#39;', ''''),
                        '&ndash;', '–'),
       schedule_type_description = replace(schedule_type_description, '&amp;', '&')
 where course_title like '%&%;%'
    or schedule_type_description like '%&%;%';

update public.course_faculty
   set display_name = replace(replace(display_name, '&amp;', '&'), '&#39;', '''')
 where display_name like '%&%;%';

update public.course_meetings
   set building_description = replace(building_description, '&amp;', '&')
 where building_description like '%&%;%';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes for the search page
-- ─────────────────────────────────────────────────────────────────────────────

-- Covers the main results query end to end:
--   WHERE term = ? [AND subject = ?] [AND course_number = ?]
--   ORDER BY subject, course_number, crn
--   LIMIT 10
-- Because crn is the last key, the ordering is total — no sort step, and
-- LIMIT 10 always returns the same rows for the same filters.
create index if not exists courses_search_order_idx
  on public.courses (term, subject, course_number, crn);

-- Class-type filter (16 distinct values in current data).
create index if not exists courses_term_class_type_idx
  on public.courses (term, schedule_type_description);

-- Instructor filter: instead of scanning every faculty row per term, start from
-- the exact name and join to the section.
create index if not exists course_faculty_name_course_idx
  on public.course_faculty (display_name, course_id);

-- Vocabulary lookup: SELECT DISTINCT display_name ... WHERE term = ? ORDER BY
-- display_name is an index-only scan with this.
create index if not exists course_faculty_term_name_idx
  on public.course_faculty (term, display_name);

-- Refresh planner statistics so the new indexes are actually chosen.
analyze public.courses;
analyze public.course_faculty;
analyze public.course_meetings;

-- Optional cleanup: courses_term_idx is now a redundant prefix of
-- courses_search_order_idx. Uncomment to reclaim it.
-- drop index if exists public.courses_term_idx;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. OPTIONAL — substring / fuzzy matching
--
-- Not needed by the current search page (suggestions are matched in the browser
-- and filters use exact equality). Uncomment if you later want
-- "contains" search on titles or instructor names, e.g. "paula" matching
-- "Di Cato, Paula".
-- ─────────────────────────────────────────────────────────────────────────────
-- create extension if not exists pg_trgm;
-- create index if not exists courses_title_trgm_idx
--   on public.courses using gin (course_title gin_trgm_ops);
-- create index if not exists course_faculty_name_trgm_idx
--   on public.course_faculty using gin (display_name gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. OPTIONAL — one-call vocabulary RPC
--
-- The app currently builds its suggestion lists with two paginated REST calls
-- (PostgREST has no DISTINCT and caps responses at 1,000 rows). If you would
-- rather have one call returning all four lists, uncomment this and tell the
-- developer to switch queries.ts to `.rpc("search_vocab", { p_term })`.
-- ─────────────────────────────────────────────────────────────────────────────
-- create or replace function public.search_vocab(p_term text)
-- returns json
-- language sql
-- stable
-- as $$
--   select json_build_object(
--     'subjects', (select json_agg(s) from (
--        select distinct subject s from public.courses
--        where term = p_term and subject is not null order by s) t),
--     'courseCodes', (select json_agg(c) from (
--        select distinct subject || ' ' || course_number c from public.courses
--        where term = p_term and subject is not null order by c) t),
--     'classTypes', (select json_agg(d) from (
--        select distinct schedule_type_description d from public.courses
--        where term = p_term and schedule_type_description is not null order by d) t),
--     'instructors', (select json_agg(n) from (
--        select distinct display_name n from public.course_faculty
--        where term = p_term and display_name is not null order by n) t)
--   );
-- $$;
--
-- grant execute on function public.search_vocab(text) to anon, authenticated;

-- Make PostgREST pick up the changes immediately.
notify pgrst, 'reload schema';

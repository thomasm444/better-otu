-- Better OTU — Multi-year Academic Calendar support for Degree Planner
--
-- Adds `catalog_year` (e.g. '2026-27', '2025-26', ..., '2016-17') so multiple
-- undergraduate academic calendar years can coexist in Supabase and students
-- can plan against the program map for their entry year (or switch years).
--
-- Apply after 20261115000000_exam_schedules.sql.
-- Every statement is idempotent so re-running is safe.

alter table public.degree_programs
  add column if not exists catalog_year text not null default '2026-27';

create index if not exists degree_programs_catalog_year_name_idx
  on public.degree_programs (catalog_year, name, program_id);

alter table public.catalog_courses
  add column if not exists catalog_year text not null default '2026-27';

alter table public.degree_plans
  add column if not exists catalog_year text;

-- Backfill existing saved degree plans with their program's catalog_year
update public.degree_plans dp
set catalog_year = p.catalog_year
from public.degree_programs p
where dp.program_id = p.program_id
  and dp.catalog_year is null;

notify pgrst, 'reload schema';

-- Better OTU — Attach an optional Minor program to saved degree plans.
--
-- Adds nullable `minor_program_id` to `public.degree_plans` so a student's
-- chosen minor persists alongside their major plan.
--
-- Apply after 20261119120000_course_offerings_summary_cache.sql.
-- Every statement is idempotent so re-running is safe.

alter table public.degree_plans
  add column if not exists minor_program_id text;

notify pgrst, 'reload schema';

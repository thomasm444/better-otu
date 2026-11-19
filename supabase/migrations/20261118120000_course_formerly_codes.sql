-- Better OTU — Structured `formerly_codes` on `catalog_courses`
--
-- Links renumbered/renamed courses across catalog years (e.g. CSCI 1050U
-- formerly CSCI 2050U, CSCI 3052U formerly CSCI 4050U) so prerequisites and
-- degree requirements treat equivalent courses interchangeably.
--
-- Apply after 20261118000000_degree_catalog_years.sql.
-- Every statement is idempotent so re-running is safe.

alter table public.catalog_courses
  add column if not exists formerly_codes text[] not null default '{}';

notify pgrst, 'reload schema';

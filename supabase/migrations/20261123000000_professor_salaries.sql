-- Better OTU — Ontario Public Sector Salary Disclosure (Sunshine List)
--
-- Creates public.professor_salaries linked to public.rmp_professors.
-- Apply after 20261121180000_backend_security_and_perf.sql.
-- Every statement is idempotent so re-running is safe.

create table if not exists public.professor_salaries (
  id                bigint generated always as identity primary key,
  sector            text not null,
  last_name         text not null,
  first_name        text not null,
  salary_paid       numeric(12, 2) not null,
  taxable_benefits  numeric(10, 2) not null,
  employer          text not null,
  job_title         text not null,
  calendar_year     integer not null,
  rmp_professor_id  text not null references public.rmp_professors (id) on delete cascade,
  updated_at        timestamptz not null default now(),
  unique (rmp_professor_id, calendar_year, last_name, first_name)
);

create index if not exists professor_salaries_rmp_prof_year_idx
  on public.professor_salaries (rmp_professor_id, calendar_year desc);

create index if not exists professor_salaries_calendar_year_idx
  on public.professor_salaries (calendar_year);

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileges & Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

grant select on public.professor_salaries
  to anon, authenticated;

grant select, insert, update, delete on public.professor_salaries
  to service_role;

grant usage, select on all sequences in schema public to service_role;

alter table public.professor_salaries enable row level security;

drop policy if exists "professor_salaries are publicly readable" on public.professor_salaries;
create policy "professor_salaries are publicly readable"
  on public.professor_salaries
  for select
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';

-- Better OTU — Degree Planner schema
--
-- Stores the normalized Ontario Tech Undergraduate Academic Calendar dataset
-- (subjects, catalog courses, degree programs, sections, requirement groups,
-- requirement items, and course-item cross-references), plus an offerings
-- summary view backed by public.courses.
--
-- Apply AFTER:
--   1. 20261028000000_baseline_courses_schema.sql
--   2. 20261028120000_search_optimizations.sql
--
-- Every statement is idempotent so re-running is safe.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. degree_subjects — subject codes & owning faculties
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.degree_subjects (
  code         text primary key,
  name         text,
  faculty      text,
  course_count integer not null default 0
);

alter table public.degree_subjects alter column name drop not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. catalog_courses — undergraduate academic calendar course definitions
--
-- Separate from public.courses, which holds Banner term *sections* (CRNs).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.catalog_courses (
  code                     text primary key,
  subject                  text not null references public.degree_subjects (code) on update cascade,
  number                   text not null,
  subject_course           text not null,
  level                    integer not null default 0,
  faculty                  text,
  subject_name             text,
  title                    text not null,
  short_title              text,
  description              text,
  credit_hours             numeric(4, 2) not null default 3.00,
  credit_hours_source      text,
  coid                     text,
  calendar_url             text,
  referenced_by_programs   boolean not null default false,
  terms_offered            text[] not null default '{}',
  offered_terms_count      integer not null default 0,
  sections_in_offerings    integer not null default 0,
  hours_lecture            text,
  hours_laboratory         text,
  hours_tutorial           text,
  hours_other              text,
  prerequisite_codes       text[] not null default '{}',
  prerequisite_mode        text,
  prerequisite_conditions  text[] not null default '{}',
  prerequisite_text        text,
  prerequisite_ast         jsonb,
  prerequisites            jsonb,
  corequisites             jsonb,
  prerequisite_concurrency jsonb,
  credit_restrictions      jsonb,
  recommended              jsonb,
  cross_listed             jsonb,
  formerly                 text,
  experiential_learning    boolean,
  fee                      text,
  notes                    text[] not null default '{}',
  enrollment               jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now()
);

create index if not exists catalog_courses_subject_level_idx
  on public.catalog_courses (subject, level, code);
create index if not exists catalog_courses_subject_course_idx
  on public.catalog_courses (subject_course);
create index if not exists catalog_courses_faculty_idx
  on public.catalog_courses (faculty);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. degree_programs — top-level program metadata
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.degree_programs (
  program_id                text primary key,
  name                      text not null,
  url                       text,
  catalog                   text,
  description               text,
  faculty                   text,
  degree                    text,
  degree_abbrev             text,
  credential                text,
  honours                   boolean not null default false,
  total_credit_hours        numeric(5, 2),
  total_credit_hours_source text,
  required_course_codes     text[] not null default '{}',
  related_programs          jsonb not null default '[]'::jsonb,
  footnotes                 jsonb not null default '{}'::jsonb,
  stats                     jsonb not null default '{}'::jsonb,
  prerequisite_analysis     jsonb not null default '{}'::jsonb,
  updated_at                timestamptz not null default now()
);

create index if not exists degree_programs_name_idx
  on public.degree_programs (name);
create index if not exists degree_programs_faculty_idx
  on public.degree_programs (faculty);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. program_sections — ordered headings within a program
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.program_sections (
  id                    bigint generated always as identity primary key,
  program_id            text not null references public.degree_programs (program_id) on delete cascade,
  section_id            text not null,
  position              integer not null,
  title                 text,
  title_clean           text,
  heading_level         integer,
  parent_section_id     text,
  merged_into           text,
  role                  text not null,
  is_alternative_track  boolean not null default false,
  is_footnote           boolean not null default false,
  is_total              boolean not null default false,
  has_requirements      boolean not null default false,
  credit_hours          numeric(5, 2),
  credit_hours_computed numeric(5, 2),
  credit_hours_mismatch boolean not null default false,
  item_count            integer not null default 0,
  description           text,
  footnote_marker       text,
  footnotes             jsonb not null default '[]'::jsonb,
  notes                 jsonb not null default '[]'::jsonb,
  unique (program_id, section_id)
);

create index if not exists program_sections_program_pos_idx
  on public.program_sections (program_id, position);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. program_groups — ordered requirement groups inside a section
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.program_groups (
  id             bigint generated always as identity primary key,
  program_id     text not null references public.degree_programs (program_id) on delete cascade,
  section_row_id bigint not null references public.program_sections (id) on delete cascade,
  group_id       text not null,
  position       integer not null,
  kind           text not null,
  required       integer,
  label          text,
  credit_hours   numeric(5, 2),
  notes          jsonb not null default '[]'::jsonb,
  unique (section_row_id, group_id)
);

create index if not exists program_groups_section_pos_idx
  on public.program_groups (section_row_id, position);
create index if not exists program_groups_program_idx
  on public.program_groups (program_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. program_items — requirement nodes (course, course_set, any_of, elective)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.program_items (
  id               bigint generated always as identity primary key,
  program_id       text not null references public.degree_programs (program_id) on delete cascade,
  group_row_id     bigint not null references public.program_groups (id) on delete cascade,
  position         integer not null,
  item_type        text not null,
  credit_hours     numeric(5, 2),
  join_type        text,
  required_count   integer,
  elective_text    text,
  elective_count   integer,
  levels           integer[],
  level_above      integer,
  match            jsonb,
  sub_requirements jsonb,
  courses          jsonb,
  options          jsonb,
  footnote_markers text[] not null default '{}'
);

create index if not exists program_items_group_pos_idx
  on public.program_items (group_row_id, position);
create index if not exists program_items_program_idx
  on public.program_items (program_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. program_item_courses — relational index of courses referenced in items
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.program_item_courses (
  id                 bigint generated always as identity primary key,
  program_id         text not null references public.degree_programs (program_id) on delete cascade,
  item_row_id        bigint not null references public.program_items (id) on delete cascade,
  course_code        text not null references public.catalog_courses (code) on delete cascade,
  position           integer not null default 0,
  is_option          boolean not null default false,
  coid               text,
  in_offerings       boolean not null default false,
  prerequisite_level integer,
  unlocks            text[] not null default '{}',
  unique (item_row_id, course_code, is_option)
);

create index if not exists program_item_courses_program_idx
  on public.program_item_courses (program_id);
create index if not exists program_item_courses_course_idx
  on public.program_item_courses (course_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. course_offerings_summary — live term offerings derived from public.courses
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.course_offerings_summary
with (security_invoker = true)
as
select
  coalesce(nullif(subject_course, ''), subject || course_number) as subject_course,
  min(subject) as subject,
  min(course_number) as course_number,
  array_agg(distinct term_desc order by term_desc) filter (where term_desc is not null) as terms,
  count(*)::integer as sections,
  max(credit_hours) as credit_hours
from public.courses
where subject is not null and course_number is not null
group by coalesce(nullif(subject_course, ''), subject || course_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Privileges & Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

grant select on
  public.degree_subjects,
  public.catalog_courses,
  public.degree_programs,
  public.program_sections,
  public.program_groups,
  public.program_items,
  public.program_item_courses,
  public.course_offerings_summary
to anon, authenticated;

grant select, insert, update, delete on
  public.degree_subjects,
  public.catalog_courses,
  public.degree_programs,
  public.program_sections,
  public.program_groups,
  public.program_items,
  public.program_item_courses
to service_role;

grant usage, select on all sequences in schema public to service_role;

alter table public.degree_subjects enable row level security;
alter table public.catalog_courses enable row level security;
alter table public.degree_programs enable row level security;
alter table public.program_sections enable row level security;
alter table public.program_groups enable row level security;
alter table public.program_items enable row level security;
alter table public.program_item_courses enable row level security;

drop policy if exists "degree_subjects are publicly readable" on public.degree_subjects;
create policy "degree_subjects are publicly readable"
  on public.degree_subjects for select to anon, authenticated using (true);

drop policy if exists "catalog_courses are publicly readable" on public.catalog_courses;
create policy "catalog_courses are publicly readable"
  on public.catalog_courses for select to anon, authenticated using (true);

drop policy if exists "degree_programs are publicly readable" on public.degree_programs;
create policy "degree_programs are publicly readable"
  on public.degree_programs for select to anon, authenticated using (true);

drop policy if exists "program_sections are publicly readable" on public.program_sections;
create policy "program_sections are publicly readable"
  on public.program_sections for select to anon, authenticated using (true);

drop policy if exists "program_groups are publicly readable" on public.program_groups;
create policy "program_groups are publicly readable"
  on public.program_groups for select to anon, authenticated using (true);

drop policy if exists "program_items are publicly readable" on public.program_items;
create policy "program_items are publicly readable"
  on public.program_items for select to anon, authenticated using (true);

drop policy if exists "program_item_courses are publicly readable" on public.program_item_courses;
create policy "program_item_courses are publicly readable"
  on public.program_item_courses for select to anon, authenticated using (true);

notify pgrst, 'reload schema';

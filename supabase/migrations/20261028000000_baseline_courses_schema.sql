-- Better OTU — baseline schema: courses, course_faculty, course_meetings
--
-- This is the committed version of the DDL that previously existed only in
-- python_scripts/schema.sql. That file is gitignored and is a destructive
-- *reset* script (it drops all three tables), so it can't serve as the record of
-- what the database looks like.
--
-- Unlike that one, this migration never drops anything: applying it to a project
-- that already has the tables is a no-op, and every statement is idempotent.
--
-- Fresh project, apply in this order:
--   1. 20261028000000_baseline_courses_schema.sql   <- this file
--   2. 20261028120000_search_optimizations.sql
--   3. python_scripts/ingest_temp.py                (fills the tables)
--
-- With the Supabase CLI:  supabase link --project-ref <ref>  &&  supabase db push
-- Without it:             paste each file into Dashboard -> SQL Editor, oldest first.

-- ─────────────────────────────────────────────────────────────────────────────
-- courses — one row per course SECTION (not per course). The same course number
-- can have several sections with different CRNs.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.courses (
  id                               bigint primary key,
  term                             text not null,
  crn                              text not null,
  term_desc                        text,
  part_of_term                     text,
  course_number                    text,
  course_display                   text,
  subject                          text,
  subject_description              text,
  sequence_number                  text,
  campus_description               text,
  schedule_type_description        text,
  course_title                     text,
  credit_hours                     numeric(4, 2),
  maximum_enrollment               integer,
  enrollment                       integer,
  seats_available                  integer,
  wait_capacity                    integer,
  wait_count                       integer,
  wait_available                   integer,
  cross_list                       text,
  cross_list_capacity              integer,
  cross_list_count                 integer,
  cross_list_available             integer,
  credit_hour_high                 numeric(4, 2),
  credit_hour_low                  numeric(4, 2),
  credit_hour_indicator            text,
  open_section                     boolean,
  link_identifier                  text,
  is_section_linked                boolean,
  subject_course                   text,
  instructional_method             text,
  instructional_method_description text,
  updated_at                       timestamptz not null default now()
);

-- (term, crn) is the natural key.
create unique index if not exists courses_term_crn_key on public.courses (term, crn);
create index if not exists courses_term_idx on public.courses (term);
create index if not exists courses_subject_idx on public.courses (subject);
create index if not exists courses_course_number_idx on public.courses (course_number);
create index if not exists courses_title_idx on public.courses (course_title);

-- ─────────────────────────────────────────────────────────────────────────────
-- course_faculty — one row per instructor on a section.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.course_faculty (
  id                bigint generated always as identity primary key,
  course_id         bigint not null references public.courses (id) on delete cascade,
  term              text not null,
  banner_id         text not null,
  display_name      text,
  email_address     text,
  category          text,
  primary_indicator boolean not null default false,
  unique (course_id, banner_id, display_name)
);

create index if not exists course_faculty_course_idx on public.course_faculty (course_id);
create index if not exists course_faculty_banner_idx on public.course_faculty (banner_id);
create index if not exists course_faculty_email_idx on public.course_faculty (email_address);

-- ─────────────────────────────────────────────────────────────────────────────
-- course_meetings — one row per scheduled meeting slot. A section can have up
-- to 12, and rows frequently render identically (same time/room, different
-- category), so consumers must de-duplicate before display.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.course_meetings (
  id                       bigint generated always as identity primary key,
  course_id                bigint not null references public.courses (id) on delete cascade,
  term                     text not null,
  category                 text,
  meeting_type             text,
  meeting_type_description text,
  meeting_schedule_type    text,
  begin_time               time,
  end_time                 time,
  start_date               date,
  end_date                 date,
  building                 text,
  building_description     text,
  room                     text,
  campus                   text,
  campus_description       text,
  credit_hour_session      numeric(4, 2),
  hours_week               numeric(4, 2),
  monday                   boolean not null default false,
  tuesday                  boolean not null default false,
  wednesday                boolean not null default false,
  thursday                 boolean not null default false,
  friday                   boolean not null default false,
  saturday                 boolean not null default false,
  sunday                   boolean not null default false
);

create index if not exists course_meetings_course_idx on public.course_meetings (course_id);
create index if not exists course_meetings_room_idx on public.course_meetings (building, room);
create index if not exists course_meetings_begin_idx on public.course_meetings (begin_time);

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileges
--
-- service_role bypasses RLS but NOT granted privileges, so these are required or
-- the ingest fails with 42501 "permission denied for table courses".
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;
grant select on public.courses, public.course_faculty, public.course_meetings
  to anon, authenticated;
grant select, insert, update, delete
  on public.courses, public.course_faculty, public.course_meetings
  to service_role;
-- Identity columns need sequence access for service_role writes.
grant usage, select on all sequences in schema public to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security: the app reads with the anon key, only the service key
-- writes.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.courses enable row level security;
alter table public.course_faculty enable row level security;
alter table public.course_meetings enable row level security;

drop policy if exists "courses are publicly readable" on public.courses;
create policy "courses are publicly readable"
  on public.courses
  for select
  to anon, authenticated
  using (true);

drop policy if exists "course_faculty are publicly readable" on public.course_faculty;
create policy "course_faculty are publicly readable"
  on public.course_faculty
  for select
  to anon, authenticated
  using (true);

drop policy if exists "course_meetings are publicly readable" on public.course_meetings;
create policy "course_meetings are publicly readable"
  on public.course_meetings
  for select
  to anon, authenticated
  using (true);

-- Make PostgREST pick up the new tables/columns immediately instead of waiting
-- for its schema cache to expire.
notify pgrst, 'reload schema';

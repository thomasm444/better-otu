-- Better OTU — Exam Schedules & Reservation Date Support
--
-- Adds:
--   1. public.exam_schedules (from Ontario Tech exam schedule API)
--   2. booking_date column on public.room_detailed_reservations
--
-- Apply after 20261113143000_degree_plans_columns.sql.

create table if not exists public.exam_schedules (
  id           bigint primary key,
  term_id      integer not null,
  term_season  text,
  term_year    integer,
  subject_id   integer,
  subject_code text,
  subject_name text,
  course_code  text,
  title        text,
  crn          text,
  instructor   text,
  exam_date    date,
  exam_time    time,
  duration     text,
  room_id      integer,
  room         text,
  location     text,
  surname      text,
  seating      text,
  amendment    text,
  notes        text,
  updated_at   timestamptz not null default now()
);

create index if not exists exam_schedules_term_idx
  on public.exam_schedules (term_id);

create index if not exists exam_schedules_room_idx
  on public.exam_schedules (room);

create index if not exists exam_schedules_course_idx
  on public.exam_schedules (subject_code, course_code);

create index if not exists exam_schedules_date_idx
  on public.exam_schedules (exam_date);

-- Allow storing exact calendar date alongside day-of-week for Infosilem reservations
alter table public.room_detailed_reservations
  add column if not exists booking_date date;

create index if not exists room_detailed_res_booking_date_idx
  on public.room_detailed_reservations (booking_date);

-- Permissions & RLS
grant usage on schema public to anon, authenticated, service_role;

grant select on public.exam_schedules to anon, authenticated;
grant select, insert, update, delete on public.exam_schedules to service_role;

alter table public.exam_schedules enable row level security;

drop policy if exists "exam_schedules are publicly readable" on public.exam_schedules;
create policy "exam_schedules are publicly readable"
  on public.exam_schedules for select to anon, authenticated using (true);

notify pgrst, 'reload schema';

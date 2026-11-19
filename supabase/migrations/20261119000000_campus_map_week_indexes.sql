-- Better OTU — Campus Map Weekly Schedule Query Indexes
--
-- Eliminates cold-start statement timeouts (Supabase anon 3s default) in
-- getCampusMapWeekSchedule() and getCampusMapRoomLookup().
--
-- Apply after 20261115000000_exam_schedules.sql. Every statement is idempotent.

-- Partial composite index matching getCampusMapWeekSchedule's course_meetings filter + keyset order.
create index if not exists course_meetings_week_schedule_idx
  on public.course_meetings (term, start_date, end_date, id)
  where room is not null and begin_time is not null and end_time is not null;

-- Composite indexes matching weekly date-range filters ordered by id (no per-page sort).
create index if not exists room_detailed_res_booking_date_id_idx
  on public.room_detailed_reservations (booking_date, id);

create index if not exists exam_schedules_date_id_idx
  on public.exam_schedules (exam_date, id);

-- Partial index matching getCampusMapRoomLookup() filtered to mapped rooms & building containers.
create index if not exists campus_spaces_lookup_idx
  on public.campus_spaces (id)
  where external_id is not null or is_building_container = true;

analyze public.course_meetings;
analyze public.room_detailed_reservations;
analyze public.exam_schedules;
analyze public.campus_spaces;

notify pgrst, 'reload schema';

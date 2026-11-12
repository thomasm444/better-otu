-- Better OTU — Campus Map Schema & Ingestion
--
-- Tables:
--   1. campus_spaces: Geospatial and schedule features for interactive map (7,500+ spaces)
--   2. campus_unmapped_spaces: Non-polygonal reservation spaces (atria, tables)
--   3. room_booking_details: Registry of all university rooms & configurations
--   4. library_study_rooms: Library group study rooms & booking slots
--   5. room_detailed_reservations: Calendar reservation occurrences
--
-- Apply after 20261028120000_search_optimizations.sql.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. campus_spaces — map features (polygons, rooms, schedules, capacities)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.campus_spaces (
  id                    text primary key,
  name                  text,
  external_id           text,
  building              text,
  floor                 text,
  floor_name            text,
  venue                 text,
  room_type             text,
  capacity              integer,
  min_capacity          integer,
  capacity_source       text,
  config_type           text,
  is_building_container boolean not null default false,
  has_schedule          boolean not null default false,
  is_library_room       boolean not null default false,
  geometry              jsonb not null,
  sub_rooms             jsonb,
  rooms_data            jsonb,
  schedules             jsonb,
  courses               jsonb,
  all_courses           jsonb,
  updated_at            timestamptz not null default now()
);

create index if not exists campus_spaces_building_idx on public.campus_spaces (building);
create index if not exists campus_spaces_floor_idx on public.campus_spaces (floor);
create index if not exists campus_spaces_has_schedule_idx on public.campus_spaces (has_schedule);
create index if not exists campus_spaces_external_id_idx on public.campus_spaces (external_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. campus_unmapped_spaces — unmapped spaces from reservation feeds
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.campus_unmapped_spaces (
  room_id     text primary key,
  building    text,
  room_type   text,
  capacity    text,
  description text,
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. room_booking_details — room registry metadata
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.room_booking_details (
  room        text primary key,
  campus      text,
  building    text,
  room_type   text,
  capacity    integer,
  config_type text,
  description text,
  raw_data    jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists room_booking_details_building_idx on public.room_booking_details (building);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. library_study_rooms — library group study rooms & bookings
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.library_study_rooms (
  room_id      text primary key,
  min_capacity integer,
  max_capacity integer,
  bookings     jsonb,
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. room_detailed_reservations — reservation occurrences
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.room_detailed_reservations (
  id         bigint generated always as identity primary key,
  room_id    text not null,
  day        integer not null,
  start_time integer not null,
  duration   integer not null,
  end_time   integer not null,
  title      text,
  type       text not null default 'reservation',
  updated_at timestamptz not null default now()
);

create index if not exists room_detailed_res_room_day_idx
  on public.room_detailed_reservations (room_id, day);

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions & RLS
-- ─────────────────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

grant select on public.campus_spaces,
                public.campus_unmapped_spaces,
                public.room_booking_details,
                public.library_study_rooms,
                public.room_detailed_reservations
  to anon, authenticated;

grant select, insert, update, delete on public.campus_spaces,
                                       public.campus_unmapped_spaces,
                                       public.room_booking_details,
                                       public.library_study_rooms,
                                       public.room_detailed_reservations
  to service_role;

grant usage, select on all sequences in schema public to service_role;

alter table public.campus_spaces enable row level security;
alter table public.campus_unmapped_spaces enable row level security;
alter table public.room_booking_details enable row level security;
alter table public.library_study_rooms enable row level security;
alter table public.room_detailed_reservations enable row level security;

drop policy if exists "campus_spaces are publicly readable" on public.campus_spaces;
create policy "campus_spaces are publicly readable"
  on public.campus_spaces for select to anon, authenticated using (true);

drop policy if exists "campus_unmapped_spaces are publicly readable" on public.campus_unmapped_spaces;
create policy "campus_unmapped_spaces are publicly readable"
  on public.campus_unmapped_spaces for select to anon, authenticated using (true);

drop policy if exists "room_booking_details are publicly readable" on public.room_booking_details;
create policy "room_booking_details are publicly readable"
  on public.room_booking_details for select to anon, authenticated using (true);

drop policy if exists "library_study_rooms are publicly readable" on public.library_study_rooms;
create policy "library_study_rooms are publicly readable"
  on public.library_study_rooms for select to anon, authenticated using (true);

drop policy if exists "room_detailed_reservations are publicly readable" on public.room_detailed_reservations;
create policy "room_detailed_reservations are publicly readable"
  on public.room_detailed_reservations for select to anon, authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. campus_map_cache — materialized GeoJSON FeatureCollection
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.campus_map_cache (
  id         text primary key,
  data       json not null,
  updated_at timestamptz not null default now()
);

grant select on public.campus_map_cache to anon, authenticated, service_role;
grant select, insert, update, delete on public.campus_map_cache to service_role;
alter table public.campus_map_cache enable row level security;

drop policy if exists "campus_map_cache is publicly readable" on public.campus_map_cache;
create policy "campus_map_cache is publicly readable"
  on public.campus_map_cache for select to anon, authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Fast Map FeatureCollection RPC
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_campus_map_data(text, text);

create or replace function public.get_campus_map_data(p_floor text default null, p_building text default null)
returns json
language plpgsql
stable
as $$
declare
  result json;
begin
  if p_floor is null and p_building is null then
    select data into result from public.campus_map_cache where id = 'default';
    if result is not null then
      return result;
    end if;
  end if;

  select json_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(
      (
        select json_agg(
          json_build_object(
            'type', 'Feature',
            'id', id,
            'geometry', geometry,
            'properties', json_build_object(
              'name', name,
              'externalId', external_id,
              'floor', floor,
              'floorName', floor_name,
              'building', building,
              'venue', venue,
              'type', room_type,
              'capacity', capacity,
              'minCapacity', min_capacity,
              'capacitySource', capacity_source,
              'configType', config_type,
              'isBuildingContainer', is_building_container,
              'hasSchedule', has_schedule,
              'isLibraryRoom', is_library_room,
              'rooms', sub_rooms,
              'roomsData', rooms_data,
              'schedules', schedules,
              'courses', courses,
              'allCourses', all_courses
            )
          )
        )
        from public.campus_spaces
        where (p_floor is null or floor = p_floor)
          and (p_building is null or building = p_building)
      ),
      '[]'::json
    ),
    'unmappedDetailedRes', coalesce(
      (
        select json_agg(
          json_build_object(
            'roomId', room_id,
            'building', building,
            'roomType', room_type,
            'capacity', capacity,
            'description', description
          )
        )
        from public.campus_unmapped_spaces
      ),
      '[]'::json
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_campus_map_data(text, text) to anon, authenticated, service_role;

-- Reload schema cache in PostgREST
notify pgrst, 'reload schema';

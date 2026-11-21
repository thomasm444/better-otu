-- Better OTU — Backend security hardening, payload caps, fast RPCs, and index optimization.
--
-- Apply after:
--   20261120160000_profiles_onboarding.sql
--
-- Every statement is idempotent so re-running is safe.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Payload & storage caps on user-writable tables (protect 500 MB Free Tier)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  -- public.degree_plans
  if not exists (
    select 1 from pg_constraint
    where conname = 'degree_plans_terms_size_check'
      and conrelid = 'public.degree_plans'::regclass
  ) then
    alter table public.degree_plans
      add constraint degree_plans_terms_size_check
      check (pg_column_size(terms) <= 65536);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'degree_plans_customs_size_check'
      and conrelid = 'public.degree_plans'::regclass
  ) then
    alter table public.degree_plans
      add constraint degree_plans_customs_size_check
      check (pg_column_size(customs) <= 65536);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'degree_plans_degree_name_len_check'
      and conrelid = 'public.degree_plans'::regclass
  ) then
    alter table public.degree_plans
      add constraint degree_plans_degree_name_len_check
      check (degree_name is null or char_length(degree_name) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'degree_plans_program_id_len_check'
      and conrelid = 'public.degree_plans'::regclass
  ) then
    alter table public.degree_plans
      add constraint degree_plans_program_id_len_check
      check (char_length(program_id) <= 64);
  end if;

  -- public.student_courses
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_courses_selected_crn_len_check'
      and conrelid = 'public.student_courses'::regclass
  ) then
    alter table public.student_courses
      add constraint student_courses_selected_crn_len_check
      check (selected_crn is null or octet_length(selected_crn) <= 16384);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'student_courses_course_code_len_check'
      and conrelid = 'public.student_courses'::regclass
  ) then
    alter table public.student_courses
      add constraint student_courses_course_code_len_check
      check (char_length(course_code) <= 32);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'student_courses_semester_len_check'
      and conrelid = 'public.student_courses'::regclass
  ) then
    alter table public.student_courses
      add constraint student_courses_semester_len_check
      check (char_length(semester) <= 16);
  end if;

  -- public.profiles
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_full_name_len_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_full_name_len_check
      check (full_name is null or char_length(full_name) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_avatar_url_len_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_url_len_check
      check (avatar_url is null or char_length(avatar_url) <= 1024);
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tighten public.profiles RLS (prevent email spoofing via client writes)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Students can insert their own profile" on public.profiles;
create policy "Students can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (
    (select auth.uid()) = id
    and lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

drop policy if exists "Students can update their own profile" on public.profiles;
create policy "Students can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check (
    (select auth.uid()) = id
    and lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fast RPCs to eliminate multi-page PostgREST scans
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.search_vocab(p_term text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'subjects', coalesce((
      select jsonb_agg(s order by s)
      from (
        select distinct subject as s
        from public.courses
        where term = p_term and subject is not null
      ) t
    ), '[]'::jsonb),
    'courseCodes', coalesce((
      select jsonb_agg(c order by c)
      from (
        select distinct subject || ' ' || course_number as c
        from public.courses
        where term = p_term and subject is not null and course_number is not null
      ) t
    ), '[]'::jsonb),
    'classTypes', coalesce((
      select jsonb_agg(d order by d)
      from (
        select distinct schedule_type_description as d
        from public.courses
        where term = p_term and schedule_type_description is not null
      ) t
    ), '[]'::jsonb),
    'instructors', coalesce((
      select jsonb_agg(n order by n)
      from (
        select distinct display_name as n
        from public.course_faculty
        where term = p_term and display_name is not null
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.search_vocab(text) from public;
grant execute on function public.search_vocab(text) to anon, authenticated, service_role;

create or replace function public.get_program_detail_json(p_program_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select
    case
      when p.program_id is null then null
      else jsonb_build_object(
        'program', jsonb_build_object(
          'program_id', p.program_id,
          'catalog_year', p.catalog_year,
          'name', p.name,
          'url', p.url,
          'catalog', p.catalog,
          'description', p.description,
          'faculty', p.faculty,
          'degree', p.degree,
          'degree_abbrev', p.degree_abbrev,
          'credential', p.credential,
          'honours', p.honours,
          'total_credit_hours', p.total_credit_hours,
          'required_course_codes', p.required_course_codes,
          'footnotes', p.footnotes
        ),
        'program_sections', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'section_id', s.section_id,
              'position', s.position,
              'title', s.title,
              'title_clean', s.title_clean,
              'role', s.role,
              'is_alternative_track', s.is_alternative_track,
              'credit_hours', s.credit_hours,
              'description', s.description
            )
            order by s.position asc
          )
          from public.program_sections s
          where s.program_id = p.program_id
        ), '[]'::jsonb),
        'program_groups', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', g.id,
              'section_row_id', g.section_row_id,
              'group_id', g.group_id,
              'position', g.position,
              'kind', g.kind,
              'required', g.required,
              'label', g.label,
              'credit_hours', g.credit_hours
            )
            order by g.position asc, g.id asc
          )
          from public.program_groups g
          where g.program_id = p.program_id
        ), '[]'::jsonb),
        'program_items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', i.id,
              'group_row_id', i.group_row_id,
              'position', i.position,
              'item_type', i.item_type,
              'credit_hours', i.credit_hours,
              'join_type', i.join_type,
              'required_count', i.required_count,
              'elective_text', i.elective_text,
              'elective_count', i.elective_count,
              'levels', i.levels,
              'level_above', i.level_above,
              'match', i.match,
              'sub_requirements', i.sub_requirements,
              'courses', i.courses,
              'options', i.options,
              'footnote_markers', i.footnote_markers
            )
            order by i.position asc, i.id asc
          )
          from public.program_items i
          where i.program_id = p.program_id
        ), '[]'::jsonb)
      )
    end
  from (select p_program_id as requested_id) req
  left join public.degree_programs p
    on p.program_id = req.requested_id;
$$;

revoke all on function public.get_program_detail_json(text) from public;
grant execute on function public.get_program_detail_json(text) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Index optimization (save RAM & speed up lookups)
-- ─────────────────────────────────────────────────────────────────────────────
drop index if exists public.courses_term_idx;
drop index if exists public.degree_programs_catalog_year_name_idx;

create index if not exists exam_schedules_term_year_season_crn_idx
  on public.exam_schedules (term_year, term_season, crn);

create index if not exists degree_plans_user_id_program_idx
  on public.degree_plans (user_id, program_id);

analyze public.courses;
analyze public.course_faculty;
analyze public.degree_programs;
analyze public.program_sections;
analyze public.program_groups;
analyze public.program_items;
analyze public.exam_schedules;
analyze public.degree_plans;
analyze public.student_courses;
analyze public.profiles;

notify pgrst, 'reload schema';

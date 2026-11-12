# Database

Supabase (Postgres). Three tables, all in the `public` schema, all populated from a
Banner course-schedule scrape.

The authoritative DDL lives in [`supabase/migrations/`](../supabase/migrations/) —
three committed, idempotent migrations. Apply them oldest first:

| migration | what it does |
| --- | --- |
| `20261028000000_baseline_courses_schema.sql` | creates the three courses tables, base indexes, grants and RLS policies |
| `20261028120000_search_optimizations.sql` | repairs HTML entities, adds the search indexes, refreshes planner statistics |
| `20261112000000_campus_map_schema.sql` | creates campus map tables (`campus_spaces`, `campus_unmapped_spaces`, booking registry, library study rooms, reservations), spatial indexes, and `get_campus_map_data()` RPC |

```bash
# With the Supabase CLI
supabase link --project-ref <project-ref>
supabase db push
```

Without the CLI, paste each file into Dashboard → SQL Editor, oldest first.
`python_scripts/schema.sql` (gitignored) is a reset script for a scratch project
only — it is no longer the source of truth.

## Relationships

```mermaid
erDiagram
    courses ||--o{ course_faculty : "has instructors"
    courses ||--o{ course_meetings : "has meeting slots"

    courses {
        bigint id PK
        text term
        text crn
        text subject
        text course_number
        text course_title
        integer enrollment
    }
    course_faculty {
        bigint id PK
        bigint course_id FK
        text banner_id
        text display_name
        text email_address
        boolean primary_indicator
    }
    course_meetings {
        bigint id PK
        bigint course_id FK
        time begin_time
        time end_time
        text building
        text room
        boolean monday
        boolean sunday
    }
```

Both child tables cascade on delete from `courses`.

## `courses`

One row per course **section** (not per course — the same course number can have
several sections with different CRNs).

| column | type | notes |
| --- | --- | --- |
| `id` | `bigint` PK | Banner's internal section id. **Not** the CRN. |
| `term` | `text` not null | Banner term code: `202609` = Fall 2026, `202701` = Winter 2027 |
| `crn` | `text` not null | Course Reference Number, e.g. `44778`. Human-facing section id. |
| `term_desc` | `text` | e.g. `Fall 2026` |
| `part_of_term` | `text` | e.g. `1` |
| `course_number` | `text` | e.g. `6000G` |
| `course_display` | `text` | usually identical to `course_number` |
| `subject` | `text` | e.g. `APBS` |
| `subject_description` | `text` | e.g. `Applied Bioscience` |
| `sequence_number` | `text` | |
| `campus_description` | `text` | e.g. `OT-North Oshawa` |
| `schedule_type_description` | `text` | e.g. `Lecture` |
| `course_title` | `text` | |
| `credit_hours` | `numeric(4,2)` | |
| `maximum_enrollment` | `integer` | |
| `enrollment` | `integer` | |
| `seats_available` | `integer` | |
| `wait_capacity` / `wait_count` / `wait_available` | `integer` | |
| `cross_list` | `text` | |
| `cross_list_capacity` / `cross_list_count` / `cross_list_available` | `integer` | |
| `credit_hour_high` / `credit_hour_low` | `numeric(4,2)` | |
| `credit_hour_indicator` | `text` | |
| `open_section` | `boolean` | |
| `link_identifier` | `text` | |
| `is_section_linked` | `boolean` | |
| `subject_course` | `text` | concatenated, e.g. `APBS6000G` |
| `instructional_method` | `text` | often null |
| `instructional_method_description` | `text` | often null |
| `updated_at` | `timestamptz` | defaults to `now()` |

Unique index on `(term, crn)` — treat that as the natural key.

Indexes:

| index | columns | serves |
| --- | --- | --- |
| `courses_term_crn_key` (unique) | `(term, crn)` | natural key |
| `courses_search_order_idx` | `(term, subject, course_number, crn)` | search filter **and** the `ORDER BY subject, course_number, crn LIMIT 10` — no sort step |
| `courses_term_class_type_idx` | `(term, schedule_type_description)` | class-type filter |
| `courses_term_idx` | `(term)` | redundant prefix of `courses_search_order_idx`; safe to drop |
| `courses_subject_idx`, `courses_course_number_idx` | single column | subject/course lookups without a term |
| `courses_title_idx` | `(course_title)` | exact title lookups |

Earlier revisions of this table held `faculty` and `meetings` as `jsonb`; they are
now proper child rows. There is no jsonb in this schema.

## `course_faculty`

One row per instructor on a section.

| column | type | notes |
| --- | --- | --- |
| `id` | `bigint` identity PK | surrogate |
| `course_id` | `bigint` FK → `courses.id` | cascade delete |
| `term` | `text` not null | denormalised to allow per-term rebuilds |
| `banner_id` | `text` not null | instructor id, e.g. `35660` |
| `display_name` | `text` | `Surname, First` |
| `email_address` | `text` | |
| `category` | `text` | always null in current data |
| `primary_indicator` | `boolean` | `true` for the instructor of record |

Unique on `(course_id, banner_id, display_name)`. Indexes on `course_id`,
`banner_id`, `email_address`, plus `(display_name, course_id)` for filtering
sections by instructor and `(term, display_name)` for the instructor suggestion
list.

## `course_meetings`

One row per scheduled meeting slot. A section can have up to 12.

| column | type | notes |
| --- | --- | --- |
| `id` | `bigint` identity PK | surrogate |
| `course_id` | `bigint` FK → `courses.id` | cascade delete |
| `term` | `text` not null | denormalised to allow per-term rebuilds |
| `category` | `text` | **not unique per section** — up to 12 rows share `01` |
| `meeting_type` | `text` | e.g. `CLAS` |
| `meeting_type_description` | `text` | e.g. `Class` |
| `meeting_schedule_type` | `text` | e.g. `LEC`, `LAB` |
| `begin_time` / `end_time` | `time` | null for async/online sections |
| `start_date` / `end_date` | `date` | |
| `building` / `building_description` | `text` | e.g. `SCI` / `Science Building (SCI)` |
| `room` | `text` | e.g. `SCI3120` |
| `campus` / `campus_description` | `text` | e.g. `UON` / `OT-North Oshawa` |
| `credit_hour_session` | `numeric(4,2)` | often null |
| `hours_week` | `numeric(4,2)` | |
| `monday` … `sunday` | `boolean` not null | day-of-week flags |

Indexes on `course_id`, `(building, room)`, `begin_time`.

## Access rules

- RLS is enabled on all three tables with a `SELECT`-only policy for `anon` and
  `authenticated`. The Next.js app reads with `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Writes require `SUPABASE_SERVICE_KEY` (`sb_secret_…` or the legacy `service_role`
  JWT). **Never** expose it to the client.
- `service_role` bypasses RLS but **not** table privileges. Any newly created table
  needs an explicit `GRANT` or writes fail with `42501 permission denied for table`.
- Identity columns also need `GRANT USAGE, SELECT ON ALL SEQUENCES`.

## Ingest

Source data is `courses.json` (Banner scrape, ~4,024 sections). The script and the
scrape output are gitignored under `python_scripts/`; the schema itself lives in
`supabase/migrations/`.

```bash
cd python_scripts
python ingest_temp.py
```

The script:

1. drops json fields into typed rows, parsing `0910` → `09:10:00` and
   `09/08/2026` → `2026-09-08`
2. upserts `courses` on `id`
3. deletes `course_faculty` / `course_meetings` **for each term**, then re-inserts
4. runs `html.unescape()` over every text value — Banner ships `Lecture &amp; Lab`
   and `Women&#39;s Health`, which would otherwise render literally

Step 3 is what makes re-runs idempotent. If a section moves between terms, stale
child rows for the old term will linger.

`schema.sql` is a **reset** script — it drops all three tables before recreating
them. It mirrors the baseline migration plus a wipe; only ever run it against a
scratch project. For anything real, use `supabase/migrations/`.

Because PostgREST caches the schema, both `schema.sql` and the baseline migration
end with `notify pgrst, 'reload schema';`. If you add columns by hand and get
`PGRST204 ... schema cache`, send that same statement.

Search-specific changes (entity repair + indexes) live in
[`supabase/migrations/20261028120000_search_optimizations.sql`](../supabase/migrations/20261028120000_search_optimizations.sql).
It is idempotent, so re-running it is harmless.

## Querying from the app

### The 1,000-row response cap

PostgREST returns **at most 1,000 rows** per request (`db-max-rows`), even if you
ask for `limit=5000`. A naive `select=subject` therefore returns only the first
1,000 sections — which is why it appears to have 23 distinct subjects instead of
56.

- Page with `.range(from, to)` for anything that needs every row.
- `collectPages()` in `src/lib/queries.ts` does this; it only requests 1,000 rows
  at a time by design.
- Never treat one response as "all rows".

### Suggestion lists

`getSearchVocab()` builds the four dropdown lists for the current term and caches
them for a day (`'use cache'`, tag `search-vocab`). Measured for `202609`:

| list | count |
| --- | --- |
| subjects | 56 |
| course codes | 693 |
| class types | 16 |
| instructor names | 436 |

That is ~18 KB in total, so the browser filters them locally and no query runs
per keystroke — a round trip to Supabase measures ~390 ms, which rules that out.

`'use cache'` functions may not read cookies, so these queries use
`src/lib/supabase/public.ts` (cookie-less anon client) rather than
`server.ts`.

### Ordering

Results are ordered `subject, course_number, crn`, limited to 10.

Every `course_number` is 4 digits + 1 letter (`1030U`, `6000G`), so text
ordering equals numeric ordering (`1030U < 2050U < 9000U`). If a shorter code
such as `900U` ever appears, plain text sort breaks and a numeric expression is
needed.

`crn` is the tiebreaker: several sections share the same `CSCI 1030U`, and
without it `LIMIT 10` can return a different set on each request.

`subject_course` is the concatenation **without** a space (`APBS6000G`), so user
input has to be normalised first — see `splitCourseCode()` in
`src/lib/queries.ts`.

### Filtering by instructor

`course_faculty` is a child table, so filtering by instructor needs the inner
join hint. Without `!inner` the embedded rows are filtered but every parent
section is still returned:

```ts
supabase
  .from("courses")
  .select("crn, course_faculty!inner(display_name)")
  .eq("course_faculty.display_name", "Banga, Janette");
```

### Text encoding

The scrape escapes HTML entities. `courses.course_title` contained 704 `&amp;`,
17 `&#39;` and 1 `&ndash;` before the repair in
`20261028120000_search_optimizations.sql`;
`schedule_type_description` contained `Lecture &amp; Lab`. The ingest now runs
`html.unescape()`, so re-ingesting produces clean text — do not re-introduce it
in any other pipeline.

## Example queries

Sections with a Monday meeting, joined to instructor and room:

```sql
select c.subject, c.course_number, c.course_title,
       f.display_name, m.room, m.begin_time, m.end_time
from public.courses c
join public.course_meetings m on m.course_id = c.id
left join public.course_faculty f on f.course_id = c.id
where c.term = '202609'
  and m.monday
order by m.begin_time;
```

Open sections with seats remaining:

```sql
select term, subject, course_number, course_title, seats_available
from public.courses
where term = '202609' and open_section
order by seats_available desc;
```

Sections with no assigned instructor (~56% of the data):

```sql
select c.term, c.subject, c.course_number, c.course_title
from public.courses c
where not exists (
  select 1 from public.course_faculty f where f.course_id = c.id
);
```

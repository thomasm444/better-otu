<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project

Better OTU — a Next.js 16 (App Router) app for browsing Ontario Tech course sections,
backed by Supabase Postgres.

- `app/` — App Router UI. Read the matching guide in `node_modules/next/dist/docs/`
  before using an unfamiliar API; this Next version diverges from most training data.
- Database — [`docs/database.md`](docs/database.md) documents the three tables
  (`courses`, `course_faculty`, `course_meetings`), their columns, relationships,
  access rules and example queries. Read it before writing any Supabase code.
- Env — copy `.env.example` to `.env` and fill it in. Never commit `.env*`.
- `python_scripts/` is **local-only and gitignored** (scrape output + ingest scripts).
  Do not assume it exists on another machine or in CI.

### Database rules

- Read with `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both child tables cascade from `courses`;
  join on `course_id`.
- Writes need `SUPABASE_SERVICE_KEY` and must stay server-side.
- `service_role` bypasses RLS but **not** table privileges — new tables need explicit
  `GRANT` plus `GRANT USAGE, SELECT ON ALL SEQUENCES`, or writes fail with `42501`.
- `python_scripts/schema.sql` is a reset script that **drops all three tables**. Never
  point it at anything but a scratch project.
- After any DDL change, run `notify pgrst, 'reload schema';` or the API returns
  `PGRST204 ... schema cache` for columns that do exist.

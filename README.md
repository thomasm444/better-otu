# Better OTU

A student portal for Ontario Tech University that replaces the tools students actually use every day — course schedules, degree planning, and campus room finding — with one site that is faster to read and easier to use.

> **Disclaimer:** Unofficial student project — not affiliated with, sponsored by, or endorsed by Ontario Tech University.

The current student systems are split across several sites, and each one is harder to use than it needs to be. Better OTU pulls the same information into one place and presents it plainly.

---

## What It Does

### Home
- Dashboard with your schedule, degree progress, and live campus room availability at a glance
- One-click shortcuts to Canvas, MyOTU, the Library, and Google Workspace apps
- Two layouts (**Classic** and **Stacked**) with the same content in both
- Profile preferences for appearance (light and dark mode), layout, degree, year of study, and minor

### Course Schedules
- Weekly timetable for your planned courses with term switching (Fall, Winter, Spring/Summer)
- Course lookup with subject and level filters
- Import courses directly from your degree plan
- Calendar export and sync, plus an **Export to Add/Drop** tool that generates a Banner link with all your CRNs at once
- Optional RateMyProf ratings on your courses

### Degree Planner
- Degree plans built from Ontario Tech's published degree requirements
- Save multiple plans (for example, your current degree and a specialization you are considering), switch between them, or change a plan's degree/specialization in place
- Program explorer that previews any degree before you add it as a plan
- Requirements sidebar showing what you still need, what each course counts toward, and how transfer credits fit into your total
- Prerequisite-aware course picker for filling in each term, with support for gap years and added study years

### Campus Map
- Live room availability across North Campus and Downtown Campus, built from real course schedules and room booking data
- Search any room (spaces in the room code are normalized), filter to free rooms, and scrub forward in time to see what opens up later
- Bookable rooms list (82 rooms) sorted by building, showing seating capacity and how long each room stays free
- Room details panel with capacity, configuration, and the room's full weekly schedule
- Direct booking link for each bookable room straight to the campus booking page

---

## Built With

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router) & React 19 |
| **Styling** | Tailwind CSS 4 |
| **Database & Auth** | Supabase (Postgres) for course, schedule, degree, and room booking data, with Google sign-in |
| **Mapping** | Leaflet & OpenStreetMap |

---

## Data

Course and meeting data comes from Ontario Tech's course schedules. Room availability combines course meetings with room booking records, so a room shows as in use whether a class or a booking is in it. Degree requirements are modelled from the university's published degree descriptions.

---

## Running Locally

1. Copy `.env.example` to `.env.local` (or `.env`) and fill in your Supabase keys (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`).
2. Install dependencies and start the development server:

   ```bash
   npm install
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) and sign in with a Google account. Supabase environment variables must be configured for data and sign-in to work.

---

## What's Next

- A public deployment so any Ontario Tech student can sign in and use it
- Automatically carry over courses you have already completed when starting a plan for a different degree
- More terms of course data as new schedules are published
- Compare course schedules with peers by adding an add-friend feature

---

## Contributors

| Name | Email |
|---|---|
| Thomas Mitchinson | `thomas.mitchinson@ontariotechu.net` |
| Frankie Antoine | `frankie.antoine@ontariotechu.net` / `frankant36@gmail.com` |
| Zainab Mehraban | `zainab.mehraban@ontariotechu.net` |
| Ruhma | `ruhmalodhi18@gmail.com` |
.
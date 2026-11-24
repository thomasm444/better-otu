# Better OTU

An independent, student-built portal that brings Ontario Tech University course scheduling, degree planning, and live campus room availability into one connected web app.

> **Disclaimer:** Unofficial student project — not affiliated with, sponsored by, or endorsed by Ontario Tech University.

---

## Inspiration

Ontario Tech students plan their degrees across several different systems, and none of them are pleasant to use. Checking your schedule, figuring out what courses you still need, and finding a free room to study in are three separate trips to three separate sites. We wanted one portal that does all three, with the information presented clearly.

Our starting point was simple: software that is functional does not have to be ugly or hard to use.

## What It Does

Better OTU is a student portal with four connected parts:

- **Home** — A dashboard with your schedule, degree progress, live room availability on campus, and one-click shortcuts to Canvas, MyOTU, the Library, and Google apps. It has two layouts, **Classic** and **Stacked**, with the same content in both.
- **Course Schedules** — A weekly timetable of your planned courses with term switching, a course lookup with subject and level filters, calendar export, and an **Export to Add/Drop** modal that builds a Banner link containing all your CRNs at once. You can also import courses straight from your degree plan.
- **Degree Planner** — Plans built from the university's published degree requirements. You can keep several plans at once (your actual degree, a specialization you are considering), preview any program before adding it, and see a requirements breakdown that shows what each course counts toward and how transfer credits fit into your total.
- **Campus Map** — Live availability for rooms across campus. Search a room, filter to what is free, move forward in time to plan ahead, and open any of the 82 bookable rooms to see its capacity, its weekly schedule, and a direct link to book it on the campus booking system.

The parts are connected: the planner feeds the schedule, and the schedule's rooms show up on the map.

## How We Built It

- **Stack:** Next.js 16 (App Router) with React 19 and Tailwind CSS 4.
- **Database:** Supabase (Postgres) holds the course catalog, course meetings, degree requirements, and room booking data.
- **Mapping:** Leaflet with OpenStreetMap.

Room availability was an interesting data problem. A room is busy if a class meets in it or if someone booked it, and those live in different data. We joined course meetings with room booking records so the map shows one true status per room, and each bookable room carries the identifier the campus booking system needs, which is how the direct booking links work.

The degree planner models each program's requirements — major requirements, choice groups, electives, level rules, transfer credits — from the university's own degree descriptions, then tracks a student's plan against them.

We split the work by page: one person each on the home page, course schedules, and degree planner, and one on the campus map, with shared components (navigation, profile) owned centrally.

## Challenges We Ran Into

- **Room codes are inconsistent.** The same room appears with and without spaces and in different formats across sources. Search has to normalize them or `SCI 1350` finds nothing while `SCI1350` works.
- **Credits are not always credits.** A 0-credit co-op course kept sneaking into credit totals as 3 credits, which made the home page, schedule, and planner disagree with each other until we traced it to that one course.
- **Two kinds of busy.** Early versions of the map only knew about classes, so booked rooms showed as free. Combining bookings with meetings fixed it, but the data needed cleaning first.
- **Requirements are worded for humans, not databases.** Turning degree descriptions into rules a planner can check (choice groups, level minimums, transfer credit) took several passes to get right.

## Accomplishments That We're Proud Of

- The planner, schedule, and map actually talk to each other — plan a degree, import it into your schedule, and find the rooms those classes are in.
- The booking links are real. Picking a room on the map takes you to that room's actual booking page, not a search page.
- The whole site works in light and dark mode and stays consistent across both home layouts.

## What We Learned

Most of the hard problems were data problems, not UI problems. Once the course, requirement, and room data was modelled properly, the pages on top of it got much simpler. We also learned to verify each other's work in the live site instead of trusting summaries — more than one "bug" turned out to be a misread, and more than one "done" was not.

## What's Next for Better OTU

- Deploy it publicly so any Ontario Tech student can sign in and use it
- When you start a plan for a different degree, automatically carry over the courses you have already completed
- Add more terms of course data as new schedules are published
- Let students save favourite rooms and get notified when one frees up
- Compare course schedules with peers by adding an add-friend feature

---

## Contributors

| Name | Email |
|---|---|
| Thomas Mitchinson | `thomas.mitchinson@ontariotechu.net` |
| Frankie Antoine | `frankie.antoine@ontariotechu.net` / `frankant36@gmail.com` |
| Zainab Mehraban | `zainab.mehraban@ontariotechu.net` |
| Ruhma | `ruhmalodhi18@gmail.com` |

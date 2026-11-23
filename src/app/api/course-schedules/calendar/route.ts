import crypto from "node:crypto";
import { connection } from "next/server";

import {
  addDaysIso,
  getAcademicDayStatus,
  getDayOfWeekMon1,
} from "@/lib/campus-map-dates";
import { inferTeachingWeekParity, SCHEDULE_TERMS } from "@/lib/schedule-queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signCalendarUser(userId: string): string {
  const secret =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "better-otu-cal";
  return crypto
    .createHmac("sha256", secret)
    .update(userId)
    .digest("hex")
    .slice(0, 32);
}

function verifyCalendarToken(userId: string, token: string): boolean {
  if (!token) return false;
  const expected = signCalendarUser(userId);
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(token, "utf8");
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

const DAY_COLUMNS = [
  { key: "monday", monIndex: 1, byDay: "MO" },
  { key: "tuesday", monIndex: 2, byDay: "TU" },
  { key: "wednesday", monIndex: 3, byDay: "WE" },
  { key: "thursday", monIndex: 4, byDay: "TH" },
  { key: "friday", monIndex: 5, byDay: "FR" },
  { key: "saturday", monIndex: 6, byDay: "SA" },
  { key: "sunday", monIndex: 7, byDay: "SU" },
] as const;

type MeetingRow = {
  begin_time: string | null;
  end_time: string | null;
  start_date: string | null;
  end_date: string | null;
  building: string | null;
  room: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
};

type CourseRow = {
  crn: string;
  subject: string | null;
  course_number: string | null;
  course_title: string | null;
  schedule_type_description: string | null;
  instructional_method_description: string | null;
  course_faculty: Array<{
    display_name: string | null;
    primary_indicator: boolean | null;
  }> | null;
  course_meetings: MeetingRow[] | null;
};

type ExamRow = {
  subject_code: string | null;
  course_code: string | null;
  title: string | null;
  crn: string | null;
  exam_date: string | null;
  exam_time: string | null;
  duration: string | null;
  room: string | null;
  location: string | null;
};

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  chunks.push(line.slice(0, 75));
  i = 75;
  while (i < line.length) {
    chunks.push(` ${line.slice(i, i + 74)}`);
    i += 74;
  }
  return chunks.join("\r\n");
}

function toCompactDate(iso: string): string {
  return iso.replace(/-/g, "");
}

function toCompactTime(time: string): string {
  const parts = time.trim().split(":");
  const hh = (parts[0] ?? "00").padStart(2, "0");
  const mm = (parts[1] ?? "00").padStart(2, "0");
  const ss = (parts[2] ?? "00").slice(0, 2).padStart(2, "0");
  return `${hh}${mm}${ss}`;
}

function formatIcsLocalDateTime(isoDate: string, time: string): string {
  return `${toCompactDate(isoDate)}T${toCompactTime(time)}`;
}

function parseDurationMinutes(raw: string | null): number {
  if (!raw) return 120;
  if (raw.includes(":")) {
    const [h, m] = raw.split(":").map((n) => Number.parseInt(n, 10));
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  }
  const num = Number.parseInt(raw, 10);
  return Number.isFinite(num) && num > 0 ? num : 120;
}

function addMinutesToTime(time: string, deltaMinutes: number): string {
  const [hStr, mStr] = time.split(":");
  const total =
    (Number.parseInt(hStr ?? "0", 10) || 0) * 60 +
    (Number.parseInt(mStr ?? "0", 10) || 0) +
    deltaMinutes;
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

function shortType(description: string | null): string {
  const lower = (description ?? "").toLowerCase();
  if (lower === "lecture" || lower === "lecture & lab") return "LEC";
  if (lower === "laboratory" || lower === "lab" || lower === "lab only") {
    return "LAB";
  }
  if (lower === "tutorial") return "TUT";
  if (lower === "seminar") return "SEM";
  return description || "Class";
}

function buildLocation(building: string | null, room: string | null): string {
  const b = (building ?? "").trim();
  const r = (room ?? "").trim();
  if (!b && !r) return "";
  if (r && b && r.toUpperCase().startsWith(b.toUpperCase())) return r;
  return [b, r].filter(Boolean).join(" ");
}

export async function GET(request: Request) {
  await connection();

  try {
    const { searchParams } = new URL(request.url);
    const requestedTerm = searchParams.get("term")?.trim() || "202609";
    const termInfo =
      SCHEDULE_TERMS.find((t) => t.code === requestedTerm) ?? SCHEDULE_TERMS[0];
    const userParam = searchParams.get("user")?.trim() || "";
    const tokenParam = searchParams.get("token")?.trim() || "";
    const crnsParam = searchParams.get("crns")?.trim() || "";
    const isDownload = searchParams.get("download") === "1";

    const crnSet = new Set<string>();

    if (userParam) {
      if (!UUID_REGEX.test(userParam)) {
        return new Response("Invalid user parameter", { status: 400 });
      }

      let isAuthorized = verifyCalendarToken(userParam, tokenParam);
      if (!isAuthorized) {
        const authClient = await createClient();
        const {
          data: { user },
        } = await authClient.auth.getUser();
        if (user && user.id === userParam) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return new Response("Unauthorized", { status: 401 });
      }

      try {
        const admin = createAdminClient();
        const { data, error } = await admin
          .from("student_courses")
          .select("course_code, selected_crn")
          .eq("user_id", userParam)
          .eq("semester", termInfo.code);

        if (!error && data) {
          for (const row of data as Array<{
            course_code: string;
            selected_crn: string | null;
          }>) {
            if (row.course_code === "__BLOCKED__" || !row.selected_crn) {
              continue;
            }
            for (const part of row.selected_crn.split(",")) {
              const clean = part.trim();
              if (/^\d+$/.test(clean)) crnSet.add(clean);
            }
          }
        }
      } catch (err) {
        console.error("Admin read of student_courses failed in calendar feed:", err);
      }
    }

    // Use explicit ?crns= when no ?user= was supplied (guest feed or direct snapshot)
    if (!userParam && crnsParam) {
      for (const part of crnsParam.split(",")) {
        const clean = part.trim();
        if (/^\d+$/.test(clean)) crnSet.add(clean);
      }
    }

    const activeCrns = [...crnSet].sort();
    const supabase = getPublicClient();

    let courseRows: CourseRow[] = [];
    let examRows: ExamRow[] = [];

    if (activeCrns.length > 0) {
      const [coursesRes, examsRes] = await Promise.all([
        supabase
          .from("courses")
          .select(
            `
            crn,
            subject,
            course_number,
            course_title,
            schedule_type_description,
            instructional_method_description,
            course_faculty ( display_name, primary_indicator ),
            course_meetings ( begin_time, end_time, start_date, end_date, building, room, monday, tuesday, wednesday, thursday, friday, saturday, sunday )
          `,
          )
          .eq("term", termInfo.code)
          .in("crn", activeCrns),
        supabase
          .from("exam_schedules")
          .select(
            "subject_code, course_code, title, crn, exam_date, exam_time, duration, room, location",
          )
          .eq("term_year", termInfo.year)
          .eq("term_season", termInfo.season.toLowerCase())
          .in("crn", activeCrns),
      ]);

      if (coursesRes.error) throw coursesRes.error;
      courseRows = (coursesRes.data ?? []) as unknown as CourseRow[];
      if (!examsRes.error && examsRes.data) {
        examRows = examsRes.data as unknown as ExamRow[];
      }
    }

    const dtStamp = `${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .slice(0, 15)}Z`;

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "PRODID:-//Better OTU//Course Schedule//EN",
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeIcsText(`Better OTU — ${termInfo.label}`)}`,
      "X-WR-TIMEZONE:America/Toronto",
      "X-PUBLISHED-TTL:PT1H",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "BEGIN:VTIMEZONE",
      "TZID:America/Toronto",
      "X-LIC-LOCATION:America/Toronto",
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0400",
      "TZNAME:EDT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:-0400",
      "TZOFFSETTO:-0500",
      "TZNAME:EST",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];

    for (const course of courseRows) {
      const subject = (course.subject ?? "").trim();
      const num = (course.course_number ?? "").trim();
      const courseCode = `${subject} ${num}`.trim();
      const comp = shortType(course.schedule_type_description);
      const instructor =
        course.course_faculty?.find((f) => f.primary_indicator)?.display_name ??
        course.course_faculty?.[0]?.display_name ??
        null;
      const isEducOrCurs = subject === "EDUC" || subject === "CURS";

      const singleEvents = new Map<
        string,
        {
          date: string;
          beginTime: string;
          endTime: string;
          rooms: Set<string>;
        }
      >();
      const recurringEvents = new Map<
        string,
        {
          startDate: string;
          endDate: string;
          beginTime: string;
          endTime: string;
          days: Set<(typeof DAY_COLUMNS)[number]>;
          rooms: Set<string>;
        }
      >();

      for (const m of course.course_meetings ?? []) {
        if (!m.begin_time || !m.end_time) continue;
        const loc = buildLocation(m.building, m.room);

        if (m.start_date && m.end_date && m.start_date === m.end_date) {
          const key = `${m.start_date}|${m.begin_time}|${m.end_time}`;
          let entry = singleEvents.get(key);
          if (!entry) {
            entry = {
              date: m.start_date,
              beginTime: m.begin_time,
              endTime: m.end_time,
              rooms: new Set(),
            };
            singleEvents.set(key, entry);
          }
          if (loc) entry.rooms.add(loc);
          continue;
        }

        const startDate =
          m.start_date ||
          (termInfo.code === "202701"
            ? "2027-01-11"
            : termInfo.code === "202605"
              ? "2026-05-04"
              : "2026-09-08");
        const endDate =
          m.end_date ||
          (termInfo.code === "202701"
            ? "2027-04-09"
            : termInfo.code === "202605"
              ? "2026-08-07"
              : "2026-12-07");

        const activeDayCols = DAY_COLUMNS.filter((d) => m[d.key]);
        if (activeDayCols.length === 0) continue;

        const daySig = activeDayCols.map((d) => d.byDay).join(",");
        const key = `${startDate}|${endDate}|${m.begin_time}|${m.end_time}|${daySig}`;
        let entry = recurringEvents.get(key);
        if (!entry) {
          entry = {
            startDate,
            endDate,
            beginTime: m.begin_time,
            endTime: m.end_time,
            days: new Set(activeDayCols),
            rooms: new Set(),
          };
          recurringEvents.set(key, entry);
        }
        if (loc) entry.rooms.add(loc);
      }

      const descParts = [
        course.course_title ?? courseCode,
        `CRN: ${course.crn}`,
        course.schedule_type_description
          ? `Type: ${course.schedule_type_description}`
          : null,
        course.instructional_method_description
          ? `Delivery: ${course.instructional_method_description}`
          : null,
        instructor ? `Instructor: ${instructor}` : null,
      ].filter(Boolean);

      for (const sEv of singleEvents.values()) {
        const parity = inferTeachingWeekParity(sEv.date, termInfo.code);
        const weekTag =
          parity === "week1" ? " [W1]" : parity === "week2" ? " [W2]" : "";
        const loc = [...sEv.rooms].join(" / ");
        const uid = `otu-${termInfo.code}-${course.crn}-${sEv.date}-${toCompactTime(sEv.beginTime)}@better-otu`;

        lines.push(
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${dtStamp}`,
          `DTSTART;TZID=America/Toronto:${formatIcsLocalDateTime(sEv.date, sEv.beginTime)}`,
          `DTEND;TZID=America/Toronto:${formatIcsLocalDateTime(sEv.date, sEv.endTime)}`,
          `SUMMARY:${escapeIcsText(`${courseCode} (${comp})${weekTag}`)}`,
          ...(loc ? [`LOCATION:${escapeIcsText(loc)}`] : []),
          `DESCRIPTION:${escapeIcsText(descParts.join("\n"))}`,
          "END:VEVENT",
        );
      }

      for (const rEv of recurringEvents.values()) {
        const dayIndices = new Set<number>([...rEv.days].map((d) => d.monIndex));
        let firstDate = rEv.startDate;
        for (let offset = 0; offset < 7; offset++) {
          const candidate = addDaysIso(rEv.startDate, offset);
          if (dayIndices.has(getDayOfWeekMon1(candidate))) {
            firstDate = candidate;
            break;
          }
        }
        if (firstDate > rEv.endDate) continue;

        const exDates: string[] = [];
        for (
          let cur = firstDate;
          cur <= rEv.endDate;
          cur = addDaysIso(cur, 1)
        ) {
          if (!dayIndices.has(getDayOfWeekMon1(cur))) continue;
          const st = getAcademicDayStatus(cur);
          if (
            st.isHoliday ||
            st.isFallExamOrStudy ||
            (st.isReadingWeek && !isEducOrCurs)
          ) {
            exDates.push(formatIcsLocalDateTime(cur, rEv.beginTime));
          }
        }

        const byDay = [...rEv.days].map((d) => d.byDay).join(",");
        const untilUtc = `${toCompactDate(addDaysIso(rEv.endDate, 1))}T045959Z`;
        const loc = [...rEv.rooms].join(" / ");
        const uid = `otu-${termInfo.code}-${course.crn}-rec-${toCompactDate(firstDate)}-${toCompactTime(rEv.beginTime)}@better-otu`;

        lines.push(
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${dtStamp}`,
          `DTSTART;TZID=America/Toronto:${formatIcsLocalDateTime(firstDate, rEv.beginTime)}`,
          `DTEND;TZID=America/Toronto:${formatIcsLocalDateTime(firstDate, rEv.endTime)}`,
          `RRULE:FREQ=WEEKLY;BYDAY=${byDay};UNTIL=${untilUtc}`,
          ...(exDates.length > 0
            ? [`EXDATE;TZID=America/Toronto:${exDates.join(",")}`]
            : []),
          `SUMMARY:${escapeIcsText(`${courseCode} (${comp})`)}`,
          ...(loc ? [`LOCATION:${escapeIcsText(loc)}`] : []),
          `DESCRIPTION:${escapeIcsText(descParts.join("\n"))}`,
          "END:VEVENT",
        );
      }
    }

    // Group exam rows by (crn, exam_date, exam_time) to merge split-room rows
    const examGroups = new Map<
      string,
      {
        code: string;
        title: string | null;
        crn: string;
        date: string;
        time: string;
        durationMins: number;
        rooms: Set<string>;
      }
    >();
    for (const ex of examRows) {
      if (!ex.crn || !ex.exam_date || !ex.exam_time) continue;
      const key = `${ex.crn}|${ex.exam_date}|${ex.exam_time}`;
      let group = examGroups.get(key);
      if (!group) {
        group = {
          code: `${(ex.subject_code ?? "").trim()} ${(ex.course_code ?? "").trim()}`.trim(),
          title: ex.title,
          crn: ex.crn,
          date: ex.exam_date,
          time: ex.exam_time,
          durationMins: parseDurationMinutes(ex.duration),
          rooms: new Set(),
        };
        examGroups.set(key, group);
      }
      if (ex.room) group.rooms.add(ex.room.trim());
    }

    for (const ex of examGroups.values()) {
      const endTime = addMinutesToTime(ex.time, ex.durationMins);
      const loc = [...ex.rooms].join(" / ");
      const uid = `otu-exam-${termInfo.code}-${ex.crn}-${ex.date}@better-otu`;

      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART;TZID=America/Toronto:${formatIcsLocalDateTime(ex.date, ex.time)}`,
        `DTEND;TZID=America/Toronto:${formatIcsLocalDateTime(ex.date, endTime)}`,
        `SUMMARY:${escapeIcsText(`Final Exam: ${ex.code}`)}`,
        ...(loc ? [`LOCATION:${escapeIcsText(loc)}`] : []),
        `DESCRIPTION:${escapeIcsText(
          `${ex.title || ex.code}\nCRN: ${ex.crn}\nCheck official Ontario Tech exam portal for surname room split.`,
        )}`,
        "END:VEVENT",
      );
    }

    lines.push("END:VCALENDAR");
    const body = `${lines.map(foldIcsLine).join("\r\n")}\r\n`;

    const headers: Record<string, string> = {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": isDownload
        ? "no-cache, no-store, must-revalidate"
        : "private, max-age=900, stale-while-revalidate=3600",
    };
    if (isDownload) {
      headers["Content-Disposition"] =
        `attachment; filename="better-otu-${termInfo.code}.ics"`;
    }

    return new Response(body, { status: 200, headers });
  } catch (error) {
    console.error("Failed to generate iCalendar feed:", error);
    return new Response("Failed to generate calendar feed", { status: 500 });
  }
}

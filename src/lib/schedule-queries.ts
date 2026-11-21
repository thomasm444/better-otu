import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import {
  DAYS_OF_WEEK,
  SCHEDULE_TERMS,
  getDefaultScheduleTerm,
  parseTimeToMinutes,
  type CourseComponentType,
  type DayOfWeek,
  type DeliveryMode,
  type NormalizedMeetingSlot,
  type ScheduleCourseGroup,
  type ScheduleSection,
  type SectionRmpInfo,
  type TermScheduleCatalog,
  type WeekPattern,
} from "@/app/course-schedules/types";
import { getCatalogCourses, getDegreeSubjects } from "@/lib/degree-queries";
import { collectPages } from "@/lib/queries";
import { getPublicClient } from "@/lib/supabase/public";

export { SCHEDULE_TERMS, getDefaultScheduleTerm };

const COMPONENT_ORDER: Record<CourseComponentType, number> = {
  LEC: 0,
  LAB: 1,
  TUT: 2,
  SEM: 3,
  OTHER: 4,
};

const DAY_ORDER = Object.fromEntries(
  DAYS_OF_WEEK.map((d, index) => [d.key, index]),
) as Record<DayOfWeek, number>;

const TERM_WEEK_ANCHORS: Record<
  string,
  { anchorMonday: string; readingWeekMonday: string }
> = {
  "202609": { anchorMonday: "2026-09-07", readingWeekMonday: "2026-10-12" },
  "202701": { anchorMonday: "2027-01-11", readingWeekMonday: "2027-02-15" },
  "202605": { anchorMonday: "2026-05-04", readingWeekMonday: "2026-06-22" },
};

/**
 * Infers teaching-week parity ("week1" = odd teaching weeks, "week2" = even teaching weeks)
 * for single-day biweekly Banner meeting rows, accounting for Reading Week breaks.
 */
export function inferTeachingWeekParity(
  isoDate: string,
  term: string,
): "week1" | "week2" | null {
  const cfg = TERM_WEEK_ANCHORS[term];
  if (!cfg || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;

  const dMs = Date.parse(`${isoDate}T00:00:00Z`);
  const anchorMs = Date.parse(`${cfg.anchorMonday}T00:00:00Z`);
  if (!Number.isFinite(dMs) || !Number.isFinite(anchorMs)) return null;

  const diffDays = Math.floor((dMs - anchorMs) / 86_400_000);
  if (diffDays < 0) return null;

  let weekIndex = Math.floor(diffDays / 7) + 1;
  if (isoDate > cfg.readingWeekMonday) {
    weekIndex -= 1;
  }
  return weekIndex % 2 === 1 ? "week1" : "week2";
}

function classifyComponent(
  scheduleTypeDescription: string | null,
): CourseComponentType {
  const lower = (scheduleTypeDescription ?? "").trim().toLowerCase();
  if (lower === "lecture" || lower === "lecture & lab") return "LEC";
  if (lower === "laboratory" || lower === "lab" || lower === "lab only") {
    return "LAB";
  }
  if (lower === "tutorial") return "TUT";
  if (lower === "seminar") return "SEM";
  return "OTHER";
}

function extractLinkGroup(linkIdentifier: string | null): string | null {
  if (!linkIdentifier) return null;
  const match = linkIdentifier.trim().match(/(\d+)$/);
  return match ? match[1] : linkIdentifier.trim();
}

function formatLocation(building: string | null, room: string | null): string {
  const b = (building ?? "").trim();
  const r = (room ?? "").trim();
  if (!b && !r) return "";
  if (r && b && r.toUpperCase().startsWith(b.toUpperCase())) return r;
  return [b, r].filter(Boolean).join(" ");
}

function normalizeTime(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{2}:\d{2}/.test(trimmed)) return trimmed.slice(0, 5);
  return trimmed;
}

type RawCourseMeeting = {
  building: string | null;
  room: string | null;
  begin_time: string | null;
  end_time: string | null;
  start_date: string | null;
  end_date: string | null;
  meeting_schedule_type: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
};

type RawRmpProfessor = {
  id: string;
  legacy_id: number | null;
  full_name: string;
  avg_rating: number | string | null;
  avg_difficulty: number | string | null;
  num_ratings: number | null;
  would_take_again_percent: number | string | null;
};

type RawCourseFaculty = {
  display_name: string | null;
  primary_indicator: boolean | null;
  rmp_professors?: RawRmpProfessor | RawRmpProfessor[] | null;
};

type RawCourseRow = {
  crn: string | null;
  subject: string | null;
  course_number: string | null;
  course_title: string | null;
  sequence_number: string | null;
  schedule_type_description: string | null;
  instructional_method: string | null;
  instructional_method_description: string | null;
  campus_description: string | null;
  credit_hours: number | string | null;
  seats_available: number | null;
  maximum_enrollment: number | null;
  wait_available: number | null;
  open_section: boolean | null;
  link_identifier: string | null;
  is_section_linked: boolean | null;
  course_faculty: RawCourseFaculty[] | null;
  course_meetings: RawCourseMeeting[] | null;
};

const ONLINE_METHODS = new Set(["WEB", "WB1", "WB2"]);
const HYBRID_METHODS = new Set(["HYB", "HYW", "OFH"]);
const VIRTUAL_ROOMS = new Set([
  "SYN",
  "ASYNCHRONOUS",
  "SYNCHRONOUS ONLINE",
]);

function normalizeSection(row: RawCourseRow, term: string): ScheduleSection | null {
  const crn = (row.crn ?? "").trim();
  const subject = (row.subject ?? "").trim().toUpperCase();
  const courseNumber = (row.course_number ?? "").trim().toUpperCase();
  if (!crn || !subject || !courseNumber) return null;

  const courseCode = `${subject} ${courseNumber}`;
  const component = classifyComponent(row.schedule_type_description);
  const faculty =
    row.course_faculty?.find((f) => f.primary_indicator) ??
    row.course_faculty?.[0];

  const rawRmp = faculty?.rmp_professors
    ? Array.isArray(faculty.rmp_professors)
      ? faculty.rmp_professors[0]
      : faculty.rmp_professors
    : null;
  const parsedRating =
    rawRmp?.avg_rating !== null && rawRmp?.avg_rating !== undefined
      ? Number(rawRmp.avg_rating)
      : null;
  const parsedDiff =
    rawRmp?.avg_difficulty !== null && rawRmp?.avg_difficulty !== undefined
      ? Number(rawRmp.avg_difficulty)
      : null;
  const parsedWta =
    rawRmp?.would_take_again_percent !== null &&
    rawRmp?.would_take_again_percent !== undefined
      ? Number(rawRmp.would_take_again_percent)
      : null;

  const rmp: SectionRmpInfo | null =
    rawRmp && parsedRating !== null && Number.isFinite(parsedRating)
      ? {
          legacyId: rawRmp.legacy_id ?? null,
          fullName: rawRmp.full_name,
          avgRating: parsedRating,
          avgDifficulty:
            parsedDiff !== null && Number.isFinite(parsedDiff)
              ? parsedDiff
              : null,
          numRatings: Number(rawRmp.num_ratings ?? 0),
          wouldTakeAgainPercent:
            parsedWta !== null && Number.isFinite(parsedWta) ? parsedWta : null,
        }
      : null;

  // Group meeting rows by (day, startTime, endTime) so biweekly dates & shared rooms merge cleanly.
  const slotGroups = new Map<
    string,
    {
      day: DayOfWeek;
      startTime: string;
      endTime: string;
      startMinutes: number;
      endMinutes: number;
      rooms: Set<string>;
      buildings: Set<string>;
      locations: Set<string>;
      singleDates: Set<string>;
      hasRangeDate: boolean;
    }
  >();

  for (const m of row.course_meetings ?? []) {
    if (!m.begin_time || !m.end_time) continue;
    const startTime = normalizeTime(m.begin_time);
    const endTime = normalizeTime(m.end_time);
    const startMinutes = parseTimeToMinutes(startTime);
    const endMinutes = parseTimeToMinutes(endTime);
    if (endMinutes <= startMinutes) continue;

    const location = formatLocation(m.building, m.room);
    const isSingleDay = Boolean(
      m.start_date && m.end_date && m.start_date === m.end_date,
    );

    for (const d of DAYS_OF_WEEK) {
      if (!m[d.key]) continue;
      const key = `${d.key}|${startTime}|${endTime}`;
      let group = slotGroups.get(key);
      if (!group) {
        group = {
          day: d.key,
          startTime,
          endTime,
          startMinutes,
          endMinutes,
          rooms: new Set(),
          buildings: new Set(),
          locations: new Set(),
          singleDates: new Set(),
          hasRangeDate: false,
        };
        slotGroups.set(key, group);
      }

      if (m.room) group.rooms.add(m.room.trim());
      if (m.building) group.buildings.add(m.building.trim());
      if (location) group.locations.add(location);
      if (isSingleDay && m.start_date) {
        group.singleDates.add(m.start_date);
      } else {
        group.hasRangeDate = true;
      }
    }
  }

  const meetings: NormalizedMeetingSlot[] = [];
  for (const g of slotGroups.values()) {
    let weekPattern: WeekPattern = "both";
    const sortedDates = [...g.singleDates].sort();

    if (!g.hasRangeDate && sortedDates.length > 0) {
      const parities = new Set<"week1" | "week2">();
      let unknown = false;
      for (const dt of sortedDates) {
        const p = inferTeachingWeekParity(dt, term);
        if (!p) unknown = true;
        else parities.add(p);
      }
      if (!unknown && parities.size === 1) {
        weekPattern = parities.has("week1") ? "week1" : "week2";
      }
    }

    meetings.push({
      day: g.day,
      startTime: g.startTime,
      endTime: g.endTime,
      startMinutes: g.startMinutes,
      endMinutes: g.endMinutes,
      room: g.rooms.size > 0 ? [...g.rooms].join(" / ") : null,
      building: g.buildings.size > 0 ? [...g.buildings].join(" / ") : null,
      location:
        g.locations.size > 0
          ? [...g.locations].join(" / ")
          : row.campus_description === "OT-Online"
            ? "Online"
            : "",
      weekPattern,
      dates: sortedDates,
    });
  }

  meetings.sort(
    (a, b) =>
      DAY_ORDER[a.day] - DAY_ORDER[b.day] ||
      a.startMinutes - b.startMinutes,
  );

  let sectionWeekPattern: WeekPattern = "both";
  if (meetings.length > 0) {
    const firstPattern = meetings[0].weekPattern;
    if (meetings.every((m) => m.weekPattern === firstPattern)) {
      sectionWeekPattern = firstPattern;
    }
  }

  const method = (row.instructional_method ?? "").trim().toUpperCase();
  const campus = (row.campus_description ?? "").trim();
  const allMeetingsVirtual =
    meetings.length > 0 &&
    meetings.every((m) =>
      VIRTUAL_ROOMS.has((m.room ?? "").trim().toUpperCase()),
    );

  const isOnline =
    ONLINE_METHODS.has(method) ||
    campus === "OT-Online" ||
    allMeetingsVirtual;

  const isAsync =
    meetings.length === 0 &&
    (method === "WEB" ||
      (campus === "OT-Online" && method !== "IND" && method !== "OFF") ||
      (method === "HYW" && campus === "OT-Online"));

  let deliveryMode: DeliveryMode = "in_person";
  if (isAsync) {
    deliveryMode = "online_async";
  } else if (isOnline && !HYBRID_METHODS.has(method)) {
    deliveryMode = "online_sync";
  } else if (HYBRID_METHODS.has(method)) {
    deliveryMode = "hybrid";
  }

  return {
    crn,
    subject,
    courseNumber,
    courseCode,
    title: (row.course_title ?? "").trim() || courseCode,
    sequenceNumber: row.sequence_number ?? null,
    scheduleTypeDescription: row.schedule_type_description ?? null,
    component,
    linkIdentifier: row.link_identifier ?? null,
    linkGroup: extractLinkGroup(row.link_identifier),
    instructionalMethod: row.instructional_method ?? null,
    instructionalMethodDescription: row.instructional_method_description ?? null,
    campusDescription: row.campus_description ?? null,
    deliveryMode,
    isOnline,
    isAsync,
    seatsAvailable:
      row.seats_available !== null && row.seats_available !== undefined
        ? Number(row.seats_available)
        : null,
    maximumEnrollment:
      row.maximum_enrollment !== null && row.maximum_enrollment !== undefined
        ? Number(row.maximum_enrollment)
        : null,
    openSection: Boolean(row.open_section),
    creditHours:
      row.credit_hours !== null && row.credit_hours !== undefined
        ? Number(row.credit_hours)
        : null,
    instructor: faculty?.display_name ?? null,
    rmp,
    weekPattern: sectionWeekPattern,
    meetings,
  };
}

function inferCourseLevel(courseNumber: string): number {
  const m = courseNumber.match(/(\d{4})/);
  if (!m) return 0;
  return Math.floor(Number(m[1]) / 1000) * 1000;
}

export async function getTermScheduleCatalog(
  term: string = getDefaultScheduleTerm(),
): Promise<TermScheduleCatalog> {
  "use cache";
  cacheLife("hours");
  cacheTag("schedule-catalog", `schedule-catalog-${term}`, "sections");

  const supabase = getPublicClient();
  const termInfo =
    SCHEDULE_TERMS.find((t) => t.code === term) ?? SCHEDULE_TERMS[0];

  const [rawSections, catalogCourses, degreeSubjects] = await Promise.all([
    collectPages((from, to) =>
      supabase
        .from("courses")
        .select(
          `
          crn,
          subject,
          course_number,
          course_title,
          sequence_number,
          schedule_type_description,
          instructional_method,
          instructional_method_description,
          campus_description,
          credit_hours,
          seats_available,
          maximum_enrollment,
          wait_available,
          open_section,
          link_identifier,
          is_section_linked,
          course_faculty ( display_name, primary_indicator, rmp_professors ( id, legacy_id, full_name, avg_rating, avg_difficulty, num_ratings, would_take_again_percent ) ),
          course_meetings ( building, room, begin_time, end_time, start_date, end_date, meeting_schedule_type, monday, tuesday, wednesday, thursday, friday, saturday, sunday )
        `,
        )
        .eq("term", termInfo.code)
        .order("subject", { ascending: true })
        .order("course_number", { ascending: true })
        .order("crn", { ascending: true })
        .range(from, to),
    ),
    getCatalogCourses(),
    getDegreeSubjects(),
  ]);

  const catalogByCode = new Map<string, (typeof catalogCourses)[number]>();
  const catalogByCompact = new Map<string, (typeof catalogCourses)[number]>();
  const allCatalogMap = new Map<string, string>();
  for (const c of catalogCourses) {
    const code = c.code.trim().toUpperCase();
    if (code) {
      catalogByCode.set(code, c);
      allCatalogMap.set(code, c.title || code);
    }
    const compact = c.subject_course.trim().toUpperCase();
    if (compact) catalogByCompact.set(compact, c);
  }

  const subjectMeta = new Map<string, (typeof degreeSubjects)[number]>();
  for (const s of degreeSubjects) {
    subjectMeta.set(s.code.trim().toUpperCase(), s);
  }

  const grouped = new Map<string, ScheduleSection[]>();
  const subjectsSet = new Set<string>();
  const instructorsSet = new Set<string>();

  for (const row of rawSections as RawCourseRow[]) {
    const sec = normalizeSection(row, termInfo.code);
    if (!sec) continue;
    subjectsSet.add(sec.subject);
    if (sec.instructor) instructorsSet.add(sec.instructor);

    const list = grouped.get(sec.courseCode) ?? [];
    list.push(sec);
    grouped.set(sec.courseCode, list);
  }

  const courses: ScheduleCourseGroup[] = [];
  let onlineCourses = 0;
  let asyncCourses = 0;
  let lectureOnlyCourses = 0;
  let biweeklyCourses = 0;

  for (const [courseCode, sections] of grouped.entries()) {
    sections.sort(
      (a, b) =>
        COMPONENT_ORDER[a.component] - COMPONENT_ORDER[b.component] ||
        a.crn.localeCompare(b.crn),
    );

    const first = sections[0];
    const compact = `${first.subject}${first.courseNumber}`;
    const cat = catalogByCode.get(courseCode) ?? catalogByCompact.get(compact);
    const subj = subjectMeta.get(first.subject);

    const byComp = new Map<CourseComponentType, ScheduleSection[]>();
    for (const sec of sections) {
      const list = byComp.get(sec.component) ?? [];
      list.push(sec);
      byComp.set(sec.component, list);
    }

    const requiredComponents = [...byComp.keys()].sort(
      (a, b) => COMPONENT_ORDER[a] - COMPONENT_ORDER[b],
    );

    const isLectureOnly =
      requiredComponents.length === 1 &&
      requiredComponents[0] === "LEC" &&
      sections.every((s) => s.scheduleTypeDescription !== "Lecture & Lab");

    const compGroups = [...byComp.values()];

    const isFullyOnlineCapable =
      compGroups.length > 0 &&
      compGroups.every((group) => group.some((s) => s.isOnline));

    const isFullyAsyncCapable =
      compGroups.length > 0 &&
      compGroups.every((group) => group.some((s) => s.isAsync));

    const hasOpenSeats =
      compGroups.length > 0 &&
      compGroups.every((group) =>
        group.some((s) => s.seatsAvailable === null || s.seatsAvailable > 0),
      );

    const hasBiweeklyComponent = sections.some(
      (s) => s.weekPattern === "week1" || s.weekPattern === "week2",
    );

    if (isFullyOnlineCapable) onlineCourses++;
    if (isFullyAsyncCapable) asyncCourses++;
    if (isLectureOnly) lectureOnlyCourses++;
    if (hasBiweeklyComponent) biweeklyCourses++;

    const maxSectionCredits = sections.reduce(
      (max, s) => (s.creditHours && s.creditHours > max ? s.creditHours : max),
      0,
    );

    courses.push({
      courseCode,
      subject: first.subject,
      courseNumber: first.courseNumber,
      title: cat?.title || first.title,
      faculty: cat?.faculty ?? subj?.faculty ?? null,
      subjectName: cat?.subject_name ?? subj?.name ?? null,
      level: cat?.level || inferCourseLevel(first.courseNumber),
      creditHours:
        maxSectionCredits > 0 ? maxSectionCredits : (cat?.credit_hours ?? 3),
      description: cat?.description ?? null,
      prerequisiteText: cat?.prerequisite_text ?? null,
      prerequisiteCodes: cat?.prerequisite_codes ?? [],
      prerequisiteAst: cat?.prerequisite_ast ?? null,
      formerlyCodes: cat?.formerly_codes ?? [],
      hoursLecture: cat?.hours_lecture ?? null,
      hoursLaboratory: cat?.hours_laboratory ?? null,
      hoursTutorial: cat?.hours_tutorial ?? null,
      sections,
      requiredComponents,
      isLectureOnly,
      isFullyOnlineCapable,
      isFullyAsyncCapable,
      hasOpenSeats,
      hasBiweeklyComponent,
    });
  }

  courses.sort((a, b) => a.courseCode.localeCompare(b.courseCode, "en"));

  for (const c of courses) {
    if (!allCatalogMap.has(c.courseCode)) {
      allCatalogMap.set(c.courseCode, c.title || c.courseCode);
    }
  }
  const allCatalogCourses: Array<{ code: string; title: string }> = [];
  for (const [code, title] of allCatalogMap) {
    allCatalogCourses.push({ code, title });
  }
  allCatalogCourses.sort((a, b) => a.code.localeCompare(b.code, "en"));

  return {
    term: termInfo.code,
    termLabel: termInfo.label,
    courses,
    allCatalogCourses,
    subjects: [...subjectsSet].sort((a, b) => a.localeCompare(b, "en")),
    instructors: [...instructorsSet].sort((a, b) => a.localeCompare(b, "en")),
    deliveryStats: {
      totalCourses: courses.length,
      onlineCourses,
      asyncCourses,
      lectureOnlyCourses,
      biweeklyCourses,
    },
  };
}

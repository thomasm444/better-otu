import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { getPublicClient } from "@/lib/supabase/public";

/** Banner term code: 202609 = Fall 2026, 202701 = Winter 2027. */
export const CURRENT_TERM = "202609";
export const TERM_LABEL = "Fall 2026";

/**
 * Supabase caps every REST response at 1,000 rows (db-max-rows), so "all rows"
 * queries must page with .range(). Results are limited to 10, so this only
 * matters when building the suggestion lists.
 */
const PAGE_SIZE = 1000;

export type Faculty = {
  display_name: string | null;
  primary_indicator: boolean | null;
};

export type Meeting = {
  building: string | null;
  room: string | null;
  begin_time: string | null;
  end_time: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
};

export type Section = {
  crn: string | null;
  subject: string | null;
  course_number: string | null;
  course_title: string | null;
  schedule_type_description: string | null;
  seats_available: number | null;
  maximum_enrollment: number | null;
  course_faculty: Faculty[] | null;
  course_meetings: Meeting[] | null;
};

/** Everything the suggestion dropdowns can offer, pre-sorted alphabetically. */
export type Vocab = {
  subjects: string[];
  courseCodes: string[];
  classTypes: string[];
  instructors: string[];
};

export type Filters = {
  subject?: string;
  courseCode?: string;
  classType?: string;
  instructor?: string;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * One embedded select instead of three round trips: PostgREST follows the
 * course_id foreign keys and returns the child rows nested in the parent.
 * `!inner` turns the instructor join into a filter instead of decoration.
 */
function sectionSelect(withInstructor: boolean) {
  return `
  crn,
  subject,
  course_number,
  course_title,
  schedule_type_description,
  seats_available,
  maximum_enrollment,
  course_faculty${withInstructor ? "!inner" : ""} ( display_name, primary_indicator ),
  course_meetings ( building, room, begin_time, end_time, monday, tuesday, wednesday, thursday, friday )
`;
}

/** Walks every 1,000-row page. Needed because of the response cap above. */
async function collectPages(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
): Promise<unknown[]> {
  const rows: unknown[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Supabase pagination failed: ${error.message}`);
    }

    const page = (data ?? []) as unknown[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) return rows;
  }
}

/**
 * Builds the four suggestion lists for a term.
 *
 * Cached for a day: the catalogue only changes when the ingest runs, and the
 * whole payload is ~18 KB (56 subjects, 693 course codes, 16 class types,
 * 436 instructor names for Fall 2026).
 */
export async function getSearchVocab(
  term: string = CURRENT_TERM,
): Promise<Vocab> {
  "use cache";
  cacheLife("days");
  cacheTag("search-vocab");

  const supabase = getPublicClient();

  const [courseRows, facultyRows] = await Promise.all([
    collectPages((from, to) =>
      supabase
        .from("courses")
        .select("subject, course_number, schedule_type_description")
        // crn is unique within a term, so paging is stable.
        .eq("term", term)
        .order("crn", { ascending: true })
        .range(from, to),
    ),
    collectPages((from, to) =>
      supabase
        .from("course_faculty")
        .select("display_name")
        .eq("term", term)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const subjects = new Set<string>();
  const courseCodes = new Set<string>();
  const classTypes = new Set<string>();

  for (const row of courseRows as {
    subject: string | null;
    course_number: string | null;
    schedule_type_description: string | null;
  }[]) {
    if (row.subject) subjects.add(row.subject);
    if (row.subject && row.course_number) {
      courseCodes.add(`${row.subject} ${row.course_number}`);
    }
    if (row.schedule_type_description) {
      classTypes.add(row.schedule_type_description);
    }
  }

  const instructors = new Set<string>();
  for (const row of facultyRows as { display_name: string | null }[]) {
    if (row.display_name) instructors.add(row.display_name);
  }

  return {
    subjects: [...subjects].sort(compareText),
    courseCodes: [...courseCodes].sort(compareText),
    classTypes: [...classTypes].sort(compareText),
    instructors: [...instructors].sort(compareText),
  };
}

/**
 * Up to 10 sections matching the filters, ordered by course code.
 *
 * `crn` is the final sort key: without it several sections share `CSCI 1030U`
 * and LIMIT 10 could return a different set on each request.
 */
export async function searchSections(
  filters: Filters,
  limit = 10,
): Promise<Section[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("sections");

  const supabase = getPublicClient();

  let query = supabase
    .from("courses")
    .select(sectionSelect(Boolean(filters.instructor)))
    .eq("term", CURRENT_TERM);

  if (filters.subject) query = query.eq("subject", filters.subject);
  if (filters.classType) {
    query = query.eq("schedule_type_description", filters.classType);
  }
  if (filters.instructor) {
    query = query.eq("course_faculty.display_name", filters.instructor);
  }
  if (filters.courseCode) {
    const code = splitCourseCode(filters.courseCode);
    if (code.subject) query = query.eq("subject", code.subject);
    if (code.number) query = query.eq("course_number", code.number);
  }

  const { data, error } = await query
    .order("subject", { ascending: true })
    .order("course_number", { ascending: true })
    .order("crn", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`searchSections failed: ${error.message}`);
  }

  return (data ?? []) as unknown as Section[];
}

/**
 * "cpsc 1030u" -> { subject: "CPSC", number: "1030U" }.
 *
 * Every course number in the catalogue is 4 digits + 1 letter, so plain text
 * ordering equals numeric ordering (1030U < 2050U < 9000U).
 */
export function splitCourseCode(value: string) {
  const compact = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const match = compact.match(/^([A-Z]{2,6})(\d{3,4}[A-Z]?)$/);

  if (!match) {
    return { subject: compact, number: undefined as string | undefined };
  }

  return { subject: match[1], number: match[2] as string | undefined };
}

export function parseFilters(input: RawSearchParams): Filters {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

  return {
    subject: first(input.subject),
    courseCode: first(input.courseCode),
    classType: first(input.classType),
    instructor: first(input.instructor),
  };
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, "en");
}

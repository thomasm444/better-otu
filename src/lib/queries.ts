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
export async function collectPages(
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

export const RESULTS_PAGE_SIZE = 10;

export type SearchResults = {
  rows: Section[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * One page of sections matching the filters, ordered by course code.
 *
 * `crn` is the final sort key: without it several sections share `CSCI 1030U`
 * and a LIMIT/OFFSET window could return a different set on each request.
 */
export async function searchSections(
  filters: Filters,
  page = 1,
): Promise<SearchResults> {
  "use cache";
  cacheLife("hours");
  cacheTag("sections");

  const supabase = getPublicClient();
  const withInstructor = Boolean(filters.instructor);

  const build = (
    select: string,
    options?: { count?: "exact"; head?: boolean },
  ) => {
    let query = supabase
      .from("courses")
      .select(select, options)
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

    return query;
  };

  const fetchPage = (pageNumber: number) =>
    build(sectionSelect(withInstructor), { count: "exact" })
      .order("subject", { ascending: true })
      .order("course_number", { ascending: true })
      .order("crn", { ascending: true })
      .range(
        (pageNumber - 1) * RESULTS_PAGE_SIZE,
        pageNumber * RESULTS_PAGE_SIZE - 1,
      );

  let currentPage = Math.max(1, Math.trunc(page));
  const first = await fetchPage(currentPage);

  let total = first.count ?? 0;
  let rows = first.data ?? [];

  // PostgREST replies 416 (PGRST103) when the offset is past the end of the
  // result set, so an out-of-range ?page= has to be clamped explicitly rather
  // than treated as "no rows".
  if (first.error) {
    if (first.error.code !== "PGRST103") {
      throw new Error(`searchSections failed: ${first.error.message}`);
    }

    const counted = await build("id", { count: "exact", head: true });

    if (counted.error) {
      throw new Error(`searchSections failed: ${counted.error.message}`);
    }

    total = counted.count ?? 0;
    currentPage = Math.max(1, Math.ceil(total / RESULTS_PAGE_SIZE));

    const retry = await fetchPage(currentPage);

    if (retry.error) {
      throw new Error(`searchSections failed: ${retry.error.message}`);
    }

    rows = retry.data ?? [];
  }

  return {
    rows: rows as unknown as Section[],
    total,
    page: currentPage,
    pageCount: Math.max(1, Math.ceil(total / RESULTS_PAGE_SIZE)),
  };
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

/** 1-based page number; anything unparseable or < 1 means page 1. */
export function parsePage(input: RawSearchParams): number {
  const raw = Array.isArray(input.page) ? input.page[0] : input.page;
  const parsed = Number.parseInt(raw ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, "en");
}

export type CampusMapFeature = {
  type: "Feature";
  id: string;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    name: string | null;
    externalId: string | null;
    floor: string | null;
    floorName: string | null;
    building: string | null;
    venue: string | null;
    type: string | null;
    capacity: number | null;
    minCapacity: number | null;
    capacitySource: string | null;
    configType: string | null;
    isBuildingContainer: boolean;
    hasSchedule: boolean;
    isLibraryRoom: boolean;
    rooms?: string[];
    roomsData?: Record<string, {
      roomId: string;
      capacity: number | null;
      capacitySource: string | null;
      type: string;
      schedules?: Record<string, Record<string, Array<{ start: number; end: number; title: string; type: string }>>>;
      courses?: Record<string, string[]>;
    }>;
    schedules?: Record<string, Record<string, Array<{ start: number; end: number; title: string; type: string }>>>;
    courses?: Record<string, string[]>;
    allCourses?: string[];
  };
};

export type CampusMapData = {
  type: "FeatureCollection";
  features: CampusMapFeature[];
  unmappedDetailedRes: Array<{
    roomId: string;
    building: string;
    roomType: string;
    capacity: string;
    description: string;
  }>;
};

/**
 * Returns the full GeoJSON FeatureCollection of all campus spaces & rooms,
 * cached using Next.js 'use cache'.
 */
export async function getCampusMapData(
  floor?: string,
  building?: string,
): Promise<CampusMapData> {
  "use cache";
  cacheLife("hours");
  cacheTag("campus-map");

  const supabase = getPublicClient();
  const { data, error } = await supabase.rpc(
    "get_campus_map_data" as never,
    {
      p_floor: floor || null,
      p_building: building || null,
    } as never,
  );

  if (error) {
    throw new Error(`getCampusMapData failed: ${error.message}`);
  }

  return (data as CampusMapData) || {
    type: "FeatureCollection",
    features: [],
    unmappedDetailedRes: [],
  };
}


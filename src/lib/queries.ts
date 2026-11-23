import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import {
  addDaysIso,
  buildWeekDays,
  CAMPUS_MAP_MAX_DATE,
  CAMPUS_MAP_MIN_DATE,
  clampWeekStart,
  getAcademicDayStatus,
  parseLibraryDateToIso,
  type WeekDayInfo,
} from "@/lib/campus-map-dates";
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

export type SectionSearchFilters = Filters & {
  crn?: string;
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

function isStatementTimeoutError(error: { message: string } | null): boolean {
  return Boolean(error && /statement timeout/i.test(error.message));
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
    let result = await fetchPage(from, from + PAGE_SIZE - 1);
    if (isStatementTimeoutError(result.error)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      result = await fetchPage(from, from + PAGE_SIZE - 1);
    }

    if (result.error) {
      throw new Error(`Supabase pagination failed: ${result.error.message}`);
    }

    const page = (result.data ?? []) as unknown[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) return rows;
  }
}

/**
 * Keyset (cursor) pagination over rows ordered ascending by `id`.
 * Avoids Postgres OFFSET scans that degrade on later pages and trigger cold-start timeouts.
 */
async function collectPagesById<IdType extends string | number>(
  fetchPage: (lastId: IdType | null, limit: number) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let lastId: IdType | null = null;

  for (;;) {
    let result = await fetchPage(lastId, PAGE_SIZE);
    if (isStatementTimeoutError(result.error)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      result = await fetchPage(lastId, PAGE_SIZE);
    }

    if (result.error) {
      throw new Error(`Supabase pagination failed: ${result.error.message}`);
    }

    const page = (result.data ?? []) as Array<{ id: IdType }>;
    rows.push(...page);

    if (page.length < PAGE_SIZE) return rows;
    lastId = page[page.length - 1].id;
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

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "search_vocab",
      { p_term: term } as never,
    );

    if (
      !rpcError &&
      rpcData &&
      typeof rpcData === "object" &&
      !Array.isArray(rpcData)
    ) {
      const raw = rpcData as Record<string, unknown>;
      const normalizeList = (val: unknown): string[] | null => {
        if (!Array.isArray(val)) return null;
        const set = new Set<string>();
        for (const item of val) {
          if (typeof item === "string" && item.length > 0) {
            set.add(item);
          }
        }
        return [...set].sort(compareText);
      };

      const subjects = normalizeList(raw.subjects);
      const courseCodes = normalizeList(raw.courseCodes);
      const classTypes = normalizeList(raw.classTypes);
      const instructors = normalizeList(raw.instructors);

      if (
        subjects &&
        courseCodes &&
        classTypes &&
        instructors &&
        (subjects.length > 0 ||
          courseCodes.length > 0 ||
          classTypes.length > 0 ||
          instructors.length > 0)
      ) {
        return { subjects, courseCodes, classTypes, instructors };
      }
    }
  } catch {
    // Fall back to paginated REST queries if the RPC is not yet deployed.
  }

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
  filters: SectionSearchFilters,
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
    if (filters.crn) query = query.eq("crn", filters.crn);
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

export function parseFilters(input: RawSearchParams): SectionSearchFilters {
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

  return {
    subject: first(input.subject),
    courseCode: first(input.courseCode),
    classType: first(input.classType),
    instructor: first(input.instructor),
    crn: first(input.crn),
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

export type ScheduleEventType = "course" | "reservation" | "library_booking" | "exam";

export type ScheduleInterval = {
  start: number;
  end: number;
  title: string;
  type: ScheduleEventType;
  meta?: string;
};

export type SubRoomMeta = {
  roomId: string;
  capacity: number | null;
  capacitySource: string | null;
  type: string;
  isBookable?: boolean;
  bookingUuid?: string | null;
};

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
    isBookable?: boolean;
    bookingUuid?: string | null;
    rooms?: string[];
    roomsData?: Record<string, SubRoomMeta>;
  };
};

export type CampusMapUnmappedSpace = {
  roomId: string;
  building: string;
  roomType: string;
  capacity: string;
  description: string;
};

export type CampusMapData = {
  type: "FeatureCollection";
  features: CampusMapFeature[];
  unmappedDetailedRes: CampusMapUnmappedSpace[];
};

export type CampusMapWeekData = {
  weekStart: string;
  weekEnd: string;
  days: WeekDayInfo[];
  schedules: Record<string, Record<string, ScheduleInterval[]>>;
  subRoomSchedules: Record<string, Record<string, ScheduleInterval[]>>;
  courses: Record<string, string[]>;
  unmappedSchedules: Record<string, Record<string, ScheduleInterval[]>>;
  libraryWindowStart: string | null;
  libraryWindowEnd: string | null;
};

type CampusSpaceRow = {
  id: string;
  name: string | null;
  external_id: string | null;
  building: string | null;
  floor: string | null;
  floor_name: string | null;
  venue: string | null;
  room_type: string | null;
  capacity: number | null;
  min_capacity: number | null;
  capacity_source: string | null;
  config_type: string | null;
  is_building_container: boolean;
  has_schedule: boolean;
  is_library_room: boolean;
  geometry: CampusMapFeature["geometry"] | null;
  sub_rooms: string[] | null;
};

type RoomBookingDetailRow = {
  room: string;
  building: string | null;
  room_type: string | null;
  capacity: number | null;
  raw_data: Record<string, unknown> | null;
};

type CampusUnmappedRow = {
  room_id: string;
  building: string | null;
  room_type: string | null;
  capacity: string | null;
  description: string | null;
};

type LibraryStudyRoomRow = {
  room_id: string;
  min_capacity: number | null;
  max_capacity: number | null;
  bookings: Array<{
    date?: string;
    startMinutes?: number;
    endMinutes?: number;
    title?: string;
    status?: string;
  }> | null;
};

type RoomLookupData = {
  extIds: string[];
  rbdBuildingMap: Record<string, string>;
  subRoomIds: string[];
};

const ALL_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const U5_EXTRA_SUB_ROOMS = ["U5-39", "U5-40", "U5-53", "U5-69A", "U5-69B", "U5-70A", "U5-70B"];
const UP_EXTRA_SUB_ROOMS = ["PAV1501", "PAV1502"];

/** Immutable campus_spaces row patches for floorplan polygons lacking external_id metadata. */
const SPACE_PATCHES: Record<
  string,
  { externalId: string; name?: string; roomType?: string }
> = {
  "4d49d7bc6d0a4ebb85b961f8": {
    externalId: "CHA126",
    name: "Alger Family Lobby",
    roomType: "Atrium",
  },
  "714f885bcd4142a6a8831ecd": {
    externalId: "SHA_ATR",
    name: "Tribute Communities Lobby",
    roomType: "Atrium",
  },
  "959b61bfde3a4b19ba7ac90a": {
    externalId: "REG100",
    name: "Regent Theatre — Main Hall",
    roomType: "Lecture Hall",
  },
};

/** Friendlier labels/types for mapped spaces whose raw floorplan names are generic ("Corridor", etc.). */
const SPACE_DISPLAY_OVERRIDES: Record<
  string,
  { name?: string; roomType?: string }
> = {
  BIT1000: { name: "Vanhaverbeke Family Atrium", roomType: "Atrium" },
  BIT2075: { name: "BIT Mezzanine", roomType: "Mezzanine" },
  CHA205: { name: "DTA 2nd Floor Atrium", roomType: "Atrium" },
  ERC1000: { name: "ERC Atrium", roomType: "Atrium" },
  SCI1200: { name: "Founding Deans Atrium", roomType: "Atrium" },
  SHA009: { name: "Mitch Frazer Foyer", roomType: "Open Space" },
};

/** Canonical uppercase alias map from Banner/Infosilem room codes to campus_spaces external_id. */
const ROOM_CODE_ALIASES: Record<string, string> = {
  BIT_ATR: "BIT1000",
  BIT_MEZ: "BIT2075",
  ERC_ATR: "ERC1000",
  SCI_W_ATR: "SCI1200",
  CHA_2_ATR: "CHA205",
  CHA_L: "CHA126",
  SHA_ATR: "SHA_ATR",
  SHA_CCL: "SHA009",
  "1020": "SIR1020",
  "1303": "SIR1303",
  "1311": "SIR1311",
  SIR2020A: "SIR2020",
  SIR2020B: "SIR2020",
  CC2402: "CCB2402WS",
  CC2403: "CCB2403WS",
  CC2404: "CCB2404WS",
  CC2405: "CCB2405WS",
  CC2406: "CCB2406WS",
  CC2407: "CCB2407WS",
  EENG304: "ENG3040",
};

function getEffectiveExternalId(id: string, externalId: string | null): string | null {
  return SPACE_PATCHES[id]?.externalId ?? externalId;
}

const VIRTUAL_ROOM_CODES = new Set([
  "SYN",
  "OFFSITE",
  "ASYNCHRONOUS",
  "SYNCHRONOUS ONLINE",
]);

function parseTimeToMins(value: string | null | undefined): number {
  if (!value) return -1;
  const [h, m] = value.split(":");
  const hours = Number.parseInt(h ?? "", 10);
  const mins = Number.parseInt(m ?? "", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return -1;
  return hours * 60 + mins;
}

function parseDurationToMins(value: string | null | undefined): number {
  if (!value) return 120;
  if (value.includes(":")) {
    const mins = parseTimeToMins(value);
    return mins > 0 ? mins : 120;
  }
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : 120;
}

type ResolvedRoomTarget =
  | { kind: "virtual" }
  | { kind: "subroom"; ids: string[] }
  | { kind: "spaces"; ids: string[] }
  | { kind: "unmapped"; ids: string[] };

/**
 * Resolves a raw room string from Banner, Infosilem, or exam_schedules into
 * canonical campus_spaces IDs, container sub-rooms, virtual (ignored), or unmapped.
 */
function resolveRoomTarget(
  rawRoom: string | null | undefined,
  extSet: Set<string>,
  rbdBuildingMap: Record<string, string>,
  subRoomSet: Set<string>,
): ResolvedRoomTarget {
  const room = (rawRoom ?? "").trim();
  if (!room) return { kind: "virtual" };
  const upper = room.toUpperCase();
  if (VIRTUAL_ROOM_CODES.has(upper)) return { kind: "virtual" };

  if (upper === "SIR2010") {
    const ids = ["SIR2010A", "SIR2010B"].filter((id) => extSet.has(id));
    if (ids.length > 0) return { kind: "spaces", ids };
  }
  if (upper === "GYM 1/2" && extSet.has("G101")) {
    return { kind: "spaces", ids: ["G101"] };
  }
  if (upper === "GYM 3/4/5" && extSet.has("G1001")) {
    return { kind: "spaces", ids: ["G1001"] };
  }

  // Check explicit aliases before raw extSet so e.g. "1020" (SIR) doesn't collide with SIV Suite 1020.
  const aliased = ROOM_CODE_ALIASES[upper];
  if (aliased) {
    if (subRoomSet.has(aliased)) return { kind: "subroom", ids: [aliased] };
    if (extSet.has(aliased)) return { kind: "spaces", ids: [aliased] };
  }

  if (subRoomSet.has(room)) {
    return { kind: "subroom", ids: [room] };
  }
  if (extSet.has(room)) {
    return { kind: "spaces", ids: [room] };
  }
  const compact = room.replace(/\s+/g, "");
  if (compact !== room) {
    if (subRoomSet.has(compact)) return { kind: "subroom", ids: [compact] };
    if (extSet.has(compact)) return { kind: "spaces", ids: [compact] };
  }
  if (room.startsWith("CC") && !room.startsWith("CCB")) {
    const candidate = `CCB${room.slice(2)}`;
    if (extSet.has(candidate)) {
      return { kind: "spaces", ids: [candidate] };
    }
  }
  const rbdBldg = rbdBuildingMap[room];
  if (rbdBldg) {
    const candidate = `${rbdBldg}${room}`;
    if (extSet.has(candidate)) {
      return { kind: "spaces", ids: [candidate] };
    }
  }
  return { kind: "unmapped", ids: [room] };
}

function getContainerSubRooms(externalId: string | null, dbSubRooms: string[] | null): string[] {
  const merged = new Set(dbSubRooms ?? []);
  if (externalId === "U5") {
    for (const r of U5_EXTRA_SUB_ROOMS) merged.add(r);
  } else if (externalId === "UP") {
    for (const r of UP_EXTRA_SUB_ROOMS) merged.add(r);
  }
  return Array.from(merged).sort(compareText);
}

/**
 * Lightweight cached room-ID lookup for weekly schedule normalization.
 */
async function getCampusMapRoomLookup(): Promise<RoomLookupData> {
  "use cache";
  cacheLife("days");
  cacheTag("campus-map-base");

  const supabase = getPublicClient();
  const [spaceIdsRaw, rbdRes] = await Promise.all([
    collectPagesById<string>((lastId, limit) => {
      let query = supabase
        .from("campus_spaces")
        .select("id, external_id, is_building_container, sub_rooms")
        .or("external_id.not.is.null,is_building_container.eq.true")
        .order("id", { ascending: true })
        .limit(limit);
      if (lastId !== null) query = query.gt("id", lastId);
      return query;
    }),
    supabase.from("room_booking_details").select("room, building"),
  ]);

  if (rbdRes.error) {
    throw new Error(`getCampusMapRoomLookup failed: ${rbdRes.error.message}`);
  }

  const extSet = new Set<string>(
    Object.values(SPACE_PATCHES).map((patch) => patch.externalId),
  );
  const subRoomSet = new Set<string>([...U5_EXTRA_SUB_ROOMS, ...UP_EXTRA_SUB_ROOMS]);

  for (const row of spaceIdsRaw as Array<{
    id: string;
    external_id: string | null;
    is_building_container: boolean;
    sub_rooms: string[] | null;
  }>) {
    const eid = getEffectiveExternalId(row.id, row.external_id);
    if (eid) extSet.add(eid);
    if (row.is_building_container && row.sub_rooms) {
      for (const sr of row.sub_rooms) subRoomSet.add(sr);
    }
  }

  const rbdBuildingMap: Record<string, string> = {};
  for (const row of (rbdRes.data ?? []) as Array<{ room: string; building: string | null }>) {
    if (row.room && row.building) {
      rbdBuildingMap[row.room] = row.building;
    }
  }

  return {
    extIds: Array.from(extSet),
    rbdBuildingMap,
    subRoomIds: Array.from(subRoomSet),
  };
}

const ROOM_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractBookingUuid(rawData: unknown): string | null {
  if (!rawData || typeof rawData !== "object") return null;
  const candidate = (rawData as Record<string, unknown>).rowId;
  return typeof candidate === "string" && ROOM_UUID_RE.test(candidate.trim())
    ? candidate.trim()
    : null;
}

/**
 * Returns the live GeoJSON FeatureCollection of all campus spaces & rooms directly
 * from `campus_spaces` + `room_booking_details` + `library_study_rooms` + `campus_unmapped_spaces`,
 * without stale baked schedules. Cached using Next.js 'use cache'.
 */
export async function getCampusMapData(
  floor?: string,
  building?: string,
): Promise<CampusMapData> {
  "use cache";
  cacheLife("days");
  cacheTag("campus-map-base");

  const supabase = getPublicClient();

  const [spacesRaw, rbdRowsRaw, unmappedRes, libRes] = await Promise.all([
    collectPagesById<string>((lastId, limit) => {
      let query = supabase
        .from("campus_spaces")
        .select(
          "id, name, external_id, building, floor, floor_name, venue, room_type, capacity, min_capacity, capacity_source, config_type, is_building_container, has_schedule, is_library_room, geometry, sub_rooms",
        )
        .order("id", { ascending: true })
        .limit(limit);
      if (lastId !== null) query = query.gt("id", lastId);
      if (floor) query = query.eq("floor", floor);
      if (building) query = query.eq("building", building);
      return query;
    }),
    collectPages((from, to) =>
      supabase
        .from("room_booking_details")
        .select("room, building, room_type, capacity, raw_data")
        .order("room", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("campus_unmapped_spaces")
      .select("room_id, building, room_type, capacity, description")
      .order("room_id", { ascending: true }),
    supabase.from("library_study_rooms").select("room_id, min_capacity, max_capacity"),
  ]);

  if (unmappedRes.error) {
    throw new Error(`getCampusMapData unmapped failed: ${unmappedRes.error.message}`);
  }
  if (libRes.error) {
    throw new Error(`getCampusMapData library failed: ${libRes.error.message}`);
  }

  const spaceRows = spacesRaw as CampusSpaceRow[];
  const rbdMap = new Map<string, RoomBookingDetailRow>();
  const rbdBuildingMap: Record<string, string> = {};
  for (const r of rbdRowsRaw as RoomBookingDetailRow[]) {
    rbdMap.set(r.room, r);
    const aliased = ROOM_CODE_ALIASES[r.room.toUpperCase()];
    if (aliased && !rbdMap.has(aliased)) {
      rbdMap.set(aliased, r);
    }
    if (r.building) rbdBuildingMap[r.room] = r.building;
  }

  const libMap = new Map<string, { min_capacity: number | null; max_capacity: number | null }>();
  for (const l of (libRes.data ?? []) as Array<{
    room_id: string;
    min_capacity: number | null;
    max_capacity: number | null;
  }>) {
    libMap.set(l.room_id, l);
  }

  const extSet = new Set<string>();
  const subRoomSet = new Set<string>([...U5_EXTRA_SUB_ROOMS, ...UP_EXTRA_SUB_ROOMS]);
  for (const row of spaceRows) {
    const eid = getEffectiveExternalId(row.id, row.external_id);
    if (eid) extSet.add(eid);
    if (row.is_building_container && row.sub_rooms) {
      for (const sr of row.sub_rooms) subRoomSet.add(sr);
    }
  }

  const extraScheduledTargets = new Set<string>(["SIR2010A", "SIR2010B", "SIR2020", "REG100"]);
  for (const room of rbdMap.keys()) {
    const resolved = resolveRoomTarget(room, extSet, rbdBuildingMap, subRoomSet);
    if (resolved.kind === "spaces") {
      for (const id of resolved.ids) extraScheduledTargets.add(id);
    }
  }

  const features: CampusMapFeature[] = [];
  for (const row of spaceRows) {
    if (!row.geometry) continue;
    const patch = SPACE_PATCHES[row.id];
    const eid = patch?.externalId ?? row.external_id;
    const displayOverride = eid ? SPACE_DISPLAY_OVERRIDES[eid] : undefined;
    const libInfo = eid ? libMap.get(eid) : undefined;
    const rbdCandidate = eid
      ? rbdMap.get(eid) ??
        (eid.startsWith("CCB") ? rbdMap.get(`CC${eid.slice(3)}`) : undefined)
      : undefined;
    // Prevent mismatched building collisions (e.g. SIV Suite "1020" vs SIR "1020")
    const rbdInfo =
      rbdCandidate && (!rbdCandidate.building || !row.building || rbdCandidate.building === row.building)
        ? rbdCandidate
        : undefined;

    const isLibraryRoom = Boolean(row.is_library_room || libInfo);
    const hasSchedule = Boolean(
      row.has_schedule ||
        isLibraryRoom ||
        (eid && extraScheduledTargets.has(eid)),
    );

    const capacity = libInfo?.max_capacity ?? row.capacity ?? rbdInfo?.capacity ?? null;
    const minCapacity = libInfo?.min_capacity ?? row.min_capacity ?? null;
    const capacitySource = libInfo
      ? "Library Study Rooms"
      : row.capacity_source ?? (rbdInfo?.capacity != null ? "Room Booking System" : null);

    let rooms: string[] | undefined;
    let roomsData: Record<string, SubRoomMeta> | undefined;
    if (row.is_building_container) {
      rooms = getContainerSubRooms(eid, row.sub_rooms);
      roomsData = {};
      for (const rid of rooms) {
        const subRbd = rbdMap.get(rid);
        roomsData[rid] = {
          roomId: rid,
          capacity: subRbd?.capacity ?? null,
          capacitySource: subRbd?.capacity != null ? "Room Booking System" : null,
          type: subRbd?.room_type || row.room_type || "Classroom",
          isBookable: Boolean(subRbd),
          bookingUuid: extractBookingUuid(subRbd?.raw_data),
        };
      }
    }

    features.push({
      type: "Feature",
      id: row.id,
      geometry: row.geometry,
      properties: {
        name: patch?.name ?? displayOverride?.name ?? row.name,
        externalId: eid,
        floor: row.floor,
        floorName: row.floor_name,
        building: row.building,
        venue: row.venue,
        type: patch?.roomType ?? displayOverride?.roomType ?? row.room_type,
        capacity,
        minCapacity,
        capacitySource,
        configType: row.config_type,
        isBuildingContainer: row.is_building_container,
        hasSchedule,
        isLibraryRoom,
        isBookable: Boolean(rbdInfo),
        bookingUuid: extractBookingUuid(rbdInfo?.raw_data),
        ...(rooms ? { rooms } : {}),
        ...(roomsData ? { roomsData } : {}),
      },
    });
  }

  const unmappedDetailedRes: CampusMapUnmappedSpace[] = (
    (unmappedRes.data ?? []) as CampusUnmappedRow[]
  )
    .filter((u) => resolveRoomTarget(u.room_id, extSet, rbdBuildingMap, subRoomSet).kind === "unmapped")
    .map((u) => ({
      roomId: u.room_id,
      building: u.building ?? "",
      roomType: u.room_type ?? "",
      capacity: u.capacity ?? "",
      description: u.description ?? "",
    }));

  return {
    type: "FeatureCollection",
    features,
    unmappedDetailedRes,
  };
}

/**
 * Fetches and accurately merges live week-by-week schedules for `[weekStart .. weekStart+6]`
 * (clamped to 2026-09-01 .. 2027-04-30) from `course_meetings`, `exam_schedules`,
 * `room_detailed_reservations`, and `library_study_rooms`.
 */
export async function getCampusMapWeekSchedule(
  rawWeekStart: string,
): Promise<CampusMapWeekData> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });
  cacheTag("campus-map-week");

  const weekStart = clampWeekStart(rawWeekStart);
  const weekEnd = addDaysIso(weekStart, 6);
  const days = buildWeekDays(weekStart);
  const inBoundDays = days.filter((d) => d.inBounds);

  if (inBoundDays.length === 0) {
    return {
      weekStart,
      weekEnd,
      days,
      schedules: {},
      subRoomSchedules: {},
      courses: {},
      unmappedSchedules: {},
      libraryWindowStart: null,
      libraryWindowEnd: null,
    };
  }

  const activeStart = inBoundDays[0].date;
  const activeEnd = inBoundDays[inBoundDays.length - 1].date;
  const inBoundDateToDayIndex = new Map<string, number>();
  for (const d of inBoundDays) {
    inBoundDateToDayIndex.set(d.date, d.dayIndex);
  }

  const terms: string[] = [];
  if (activeStart <= "2026-12-20") terms.push("202609");
  if (activeEnd >= "2027-01-01") terms.push("202701");

  // Monday 2027-04-12 uses Friday courses whose end_date in Banner is 2027-04-09.
  const courseQueryMinEndDate =
    activeStart <= "2027-04-12" && activeEnd >= "2027-04-12" && activeStart > "2027-04-09"
      ? "2027-04-09"
      : activeStart;

  const supabase = getPublicClient();

  const [lookup, courseRowsRaw, reservationRowsRaw, examRowsRaw, libraryRes] = await Promise.all([
    getCampusMapRoomLookup(),
    terms.length > 0
      ? collectPagesById<number>((lastId, limit) => {
          let query = supabase
            .from("course_meetings")
            .select(
              `
              id,
              term,
              begin_time,
              end_time,
              start_date,
              end_date,
              room,
              meeting_schedule_type,
              monday,
              tuesday,
              wednesday,
              thursday,
              friday,
              saturday,
              sunday,
              courses!inner ( subject, course_number, schedule_type_description, crn )
            `,
            )
            .in("term", terms)
            .lte("start_date", activeEnd)
            .gte("end_date", courseQueryMinEndDate)
            .not("room", "is", null)
            .not("begin_time", "is", null)
            .not("end_time", "is", null)
            .order("id", { ascending: true })
            .limit(limit);
          if (lastId !== null) query = query.gt("id", lastId);
          return query;
        })
      : Promise.resolve([]),
    collectPagesById<number>((lastId, limit) => {
      let query = supabase
        .from("room_detailed_reservations")
        .select("id, room_id, booking_date, start_time, end_time, title, type")
        .gte("booking_date", activeStart)
        .lte("booking_date", activeEnd)
        .order("id", { ascending: true })
        .limit(limit);
      if (lastId !== null) query = query.gt("id", lastId);
      return query;
    }),
    collectPagesById<number>((lastId, limit) => {
      let query = supabase
        .from("exam_schedules")
        .select("id, subject_code, course_code, exam_date, exam_time, duration, room, crn")
        .gte("exam_date", activeStart)
        .lte("exam_date", activeEnd)
        .order("id", { ascending: true })
        .limit(limit);
      if (lastId !== null) query = query.gt("id", lastId);
      return query;
    }),
    supabase.from("library_study_rooms").select("room_id, bookings"),
  ]);

  if (libraryRes.error) {
    throw new Error(`getCampusMapWeekSchedule library failed: ${libraryRes.error.message}`);
  }

  const extSet = new Set(lookup.extIds);
  const subRoomSet = new Set(lookup.subRoomIds);

  const schedules: Record<string, Record<string, ScheduleInterval[]>> = {};
  const subRoomSchedules: Record<string, Record<string, ScheduleInterval[]>> = {};
  const unmappedSchedules: Record<string, Record<string, ScheduleInterval[]>> = {};
  const coursesByRoom = new Map<string, Set<string>>();

  // Track exact Banner slots per (targetKey, date) to strip overlapping Infosilem "Course-Related Booking" twins.
  const bannerRanges = new Map<string, Array<{ start: number; end: number }>>();
  // Deduplicate cross-listed courses & multi-CRN exams sharing the exact same room + date + start + end.
  const courseGroups = new Map<
    string,
    {
      bucket: "spaces" | "subroom" | "unmapped";
      roomId: string;
      dayIndex: number;
      start: number;
      end: number;
      codes: Set<string>;
      schedTypes: Set<string>;
      crns: Set<string>;
    }
  >();
  const examGroups = new Map<
    string,
    {
      bucket: "spaces" | "subroom" | "unmapped";
      roomId: string;
      dayIndex: number;
      start: number;
      end: number;
      codes: Set<string>;
      crns: Set<string>;
    }
  >();

  const recordCourseSearchCode = (bucket: "spaces" | "subroom" | "unmapped", roomId: string, code: string) => {
    const key = bucket === "subroom" ? (roomId.startsWith("PAV") ? "UP" : roomId.startsWith("U5") ? "U5" : roomId) : roomId;
    let set = coursesByRoom.get(key);
    if (!set) {
      set = new Set<string>();
      coursesByRoom.set(key, set);
    }
    set.add(code);
  };

  type CourseMeetingJoinedRow = {
    term: string;
    begin_time: string;
    end_time: string;
    start_date: string;
    end_date: string;
    room: string;
    meeting_schedule_type: string | null;
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
    sunday: boolean;
    courses:
      | {
          subject: string | null;
          course_number: string | null;
          schedule_type_description: string | null;
          crn: string | null;
        }
      | Array<{
          subject: string | null;
          course_number: string | null;
          schedule_type_description: string | null;
          crn: string | null;
        }>;
  };

  // 1. Live Banner course meetings (respecting single-day biweekly dates, holidays, Reading Week, and Apr 12 Friday makeup)
  for (const m of courseRowsRaw as CourseMeetingJoinedRow[]) {
    const start = parseTimeToMins(m.begin_time);
    const end = parseTimeToMins(m.end_time);
    if (start < 0 || end <= start) continue;

    const course = Array.isArray(m.courses) ? m.courses[0] : m.courses;
    if (!course) continue;
    const subject = (course.subject ?? "").trim();
    const courseNum = (course.course_number ?? "").trim();
    const code = `${subject} ${courseNum}`.trim();
    const schedType = m.meeting_schedule_type || course.schedule_type_description || "";
    const resolved = resolveRoomTarget(m.room, extSet, lookup.rbdBuildingMap, subRoomSet);
    if (resolved.kind === "virtual") continue;

    const isEducOrCurs = subject === "EDUC" || subject === "CURS";

    for (const dayInfo of inBoundDays) {
      const date = dayInfo.date;
      if (m.term === "202609" && date > "2026-12-20") continue;
      if (m.term === "202701" && date < "2027-01-01") continue;

      const status = getAcademicDayStatus(date);
      if (status.isHoliday || status.isFallExamOrStudy) continue;

      let matchesDate = false;
      if (status.isMakeupFriday) {
        if (
          m.term === "202701" &&
          m.friday &&
          m.start_date <= date &&
          (m.end_date >= date || (m.start_date !== m.end_date && m.end_date === "2027-04-09"))
        ) {
          matchesDate = true;
        }
      } else {
        const wcol = ALL_WEEKDAYS[dayInfo.dayIndex - 1];
        if (m[wcol] && m.start_date <= date && date <= m.end_date) {
          if (!status.isReadingWeek || isEducOrCurs) {
            matchesDate = true;
          }
        }
      }

      if (!matchesDate) continue;

      for (const targetRoomId of resolved.ids) {
        const rangeKey = `${resolved.kind}:${targetRoomId}:${date}`;
        const list = bannerRanges.get(rangeKey) ?? [];
        list.push({ start, end });
        bannerRanges.set(rangeKey, list);

        const groupKey = `${rangeKey}:${start}:${end}`;
        let group = courseGroups.get(groupKey);
        if (!group) {
          group = {
            bucket: resolved.kind,
            roomId: targetRoomId,
            dayIndex: dayInfo.dayIndex,
            start,
            end,
            codes: new Set(),
            schedTypes: new Set(),
            crns: new Set(),
          };
          courseGroups.set(groupKey, group);
        }
        if (code) {
          group.codes.add(code);
          recordCourseSearchCode(resolved.kind, targetRoomId, code);
        }
        if (schedType) group.schedTypes.add(schedType);
        if (course.crn) group.crns.add(course.crn);
      }
    }
  }

  const pushInterval = (
    bucket: "spaces" | "subroom" | "unmapped",
    roomId: string,
    dayIndex: number,
    interval: ScheduleInterval,
  ) => {
    const store =
      bucket === "spaces" ? schedules : bucket === "subroom" ? subRoomSchedules : unmappedSchedules;
    let byDay = store[roomId];
    if (!byDay) {
      byDay = {};
      store[roomId] = byDay;
    }
    const dayKey = String(dayIndex);
    if (!byDay[dayKey]) byDay[dayKey] = [];
    byDay[dayKey].push(interval);
  };

  for (const g of courseGroups.values()) {
    const codes = Array.from(g.codes).sort(compareText);
    const types = Array.from(g.schedTypes).sort(compareText);
    const typeLabel = types.length > 0 ? ` (${types.join("/")})` : "";
    const crnList = Array.from(g.crns).sort(compareText);
    pushInterval(g.bucket, g.roomId, g.dayIndex, {
      start: g.start,
      end: g.end,
      title: `${codes.join(" / ") || "Course"}${typeLabel}`,
      type: "course",
      ...(crnList.length > 0 ? { meta: `CRN ${crnList.join(", ")}` } : {}),
    });
  }

  // 2. Live exam schedules (`exam_schedules`)
  for (const ex of examRowsRaw as Array<{
    subject_code: string | null;
    course_code: string | null;
    exam_date: string;
    exam_time: string | null;
    duration: string | null;
    room: string | null;
    crn: string | null;
  }>) {
    const dayIndex = inBoundDateToDayIndex.get(ex.exam_date);
    if (!dayIndex) continue;
    const start = parseTimeToMins(ex.exam_time);
    if (start < 0) continue;
    const end = start + parseDurationToMins(ex.duration);
    const resolved = resolveRoomTarget(ex.room, extSet, lookup.rbdBuildingMap, subRoomSet);
    if (resolved.kind === "virtual") continue;

    const code = `${(ex.subject_code ?? "").trim()} ${(ex.course_code ?? "").trim()}`.trim();
    for (const targetRoomId of resolved.ids) {
      const groupKey = `${resolved.kind}:${targetRoomId}:${ex.exam_date}:${start}:${end}`;
      let group = examGroups.get(groupKey);
      if (!group) {
        group = {
          bucket: resolved.kind,
          roomId: targetRoomId,
          dayIndex,
          start,
          end,
          codes: new Set(),
          crns: new Set(),
        };
        examGroups.set(groupKey, group);
      }
      if (code) {
        group.codes.add(code);
        recordCourseSearchCode(resolved.kind, targetRoomId, code);
      }
      if (ex.crn) group.crns.add(ex.crn);
    }
  }

  for (const ex of examGroups.values()) {
    const codes = Array.from(ex.codes).sort(compareText);
    const crns = Array.from(ex.crns).sort(compareText);
    pushInterval(ex.bucket, ex.roomId, ex.dayIndex, {
      start: ex.start,
      end: ex.end,
      title: `Exam: ${codes.join(" / ") || "Final Exam"}`,
      type: "exam",
      ...(crns.length > 0 ? { meta: `CRN ${crns.slice(0, 4).join(", ")}${crns.length > 4 ? "…" : ""}` } : {}),
    });
  }

  // 3. Infosilem reservations (`room_detailed_reservations`), deduplicated against Banner overlaps
  const seenResKeys = new Set<string>();
  for (const res of reservationRowsRaw as Array<{
    room_id: string | null;
    booking_date: string;
    start_time: number;
    end_time: number;
    title: string | null;
    type: string | null;
  }>) {
    const dayIndex = inBoundDateToDayIndex.get(res.booking_date);
    if (!dayIndex || !res.room_id) continue;
    if (!Number.isFinite(res.start_time) || !Number.isFinite(res.end_time) || res.end_time <= res.start_time) {
      continue;
    }
    const resolved = resolveRoomTarget(res.room_id, extSet, lookup.rbdBuildingMap, subRoomSet);
    if (resolved.kind === "virtual") continue;

    const title = res.title || "Course-Related Booking";
    for (const targetRoomId of resolved.ids) {
      const rangeKey = `${resolved.kind}:${targetRoomId}:${res.booking_date}`;
      const existingCourses = bannerRanges.get(rangeKey);
      if (
        existingCourses?.some(
          (c) => (res.start_time === c.start - 10 || res.start_time === c.start) && res.end_time === c.end,
        )
      ) {
        continue;
      }
      const dedupeKey = `${rangeKey}:${res.start_time}:${res.end_time}:${title}`;
      if (seenResKeys.has(dedupeKey)) continue;
      seenResKeys.add(dedupeKey);

      pushInterval(resolved.kind, targetRoomId, dayIndex, {
        start: res.start_time,
        end: res.end_time,
        title,
        type: "reservation",
      });
    }
  }

  // 4. Live Library Study Room Bookings (`library_study_rooms`, ~7-day rolling window)
  let libraryWindowStart: string | null = null;
  let libraryWindowEnd: string | null = null;
  const seenLibKeys = new Set<string>();

  for (const lib of (libraryRes.data ?? []) as LibraryStudyRoomRow[]) {
    for (const b of lib.bookings ?? []) {
      const iso = parseLibraryDateToIso(b.date);
      if (!iso) continue;
      if (iso >= CAMPUS_MAP_MIN_DATE && iso <= CAMPUS_MAP_MAX_DATE) {
        if (!libraryWindowStart || iso < libraryWindowStart) libraryWindowStart = iso;
        if (!libraryWindowEnd || iso > libraryWindowEnd) libraryWindowEnd = iso;
      }

      const dayIndex = inBoundDateToDayIndex.get(iso);
      if (!dayIndex) continue;
      const start = Number(b.startMinutes);
      const end = Number(b.endMinutes);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

      const title = b.title || b.status || "Booked";
      const libKey = `${lib.room_id}:${iso}:${start}:${end}:${title}`;
      if (seenLibKeys.has(libKey)) continue;
      seenLibKeys.add(libKey);

      pushInterval("spaces", lib.room_id, dayIndex, {
        start,
        end,
        title,
        type: "library_booking",
      });
    }
  }

  const sortStore = (store: Record<string, Record<string, ScheduleInterval[]>>) => {
    for (const byDay of Object.values(store)) {
      for (const events of Object.values(byDay)) {
        events.sort((a, b) => a.start - b.start || a.end - b.end || compareText(a.title, b.title));
      }
    }
  };
  sortStore(schedules);
  sortStore(subRoomSchedules);
  sortStore(unmappedSchedules);

  // Also ensure any room outside campus_spaces defaults that had library bookings gets a clean ISO-normalized fallback if needed
  const courses: Record<string, string[]> = {};
  for (const [roomId, set] of coursesByRoom.entries()) {
    courses[roomId] = Array.from(set).sort(compareText);
  }

  return {
    weekStart,
    weekEnd,
    days,
    schedules,
    subRoomSchedules,
    courses,
    unmappedSchedules,
    libraryWindowStart,
    libraryWindowEnd,
  };
}

/**
 * Counts how many scheduled campus rooms (`hasSchedule === true`) are free
 * during `[slotStart, slotStart + 30]` on `dayIndex` of `weekStart`, including
 * scheduled rooms that have 0 events that week.
 */
export async function getCampusLiveFreeRoomCount(
  weekStart: string,
  dayIndex: number,
  slotStart: number,
): Promise<number> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });
  cacheTag("campus-map-base", "campus-map-week");

  const [mapData, weekData] = await Promise.all([
    getCampusMapData(),
    getCampusMapWeekSchedule(weekStart),
  ]);

  const dayKey = String(dayIndex);
  const slotEnd = slotStart + 30;
  const seenRooms = new Set<string>();
  const seenSubRooms = new Set<string>();
  let freeCount = 0;

  for (const feature of mapData.features) {
    const p = feature.properties;
    if (!p.hasSchedule) continue;

    if (p.isBuildingContainer && p.rooms && p.rooms.length > 0) {
      for (const rid of p.rooms) {
        if (seenSubRooms.has(rid)) continue;
        seenSubRooms.add(rid);
        const intervals = weekData.subRoomSchedules[rid]?.[dayKey] ?? [];
        const isBusy = intervals.some(
          (ev) => ev.start < slotEnd && ev.end > slotStart,
        );
        if (!isBusy) freeCount++;
      }
      continue;
    }

    const eid = p.externalId;
    if (eid) {
      if (seenRooms.has(eid)) continue;
      seenRooms.add(eid);
      const intervals = weekData.schedules[eid]?.[dayKey] ?? [];
      const isBusy = intervals.some(
        (ev) => ev.start < slotEnd && ev.end > slotStart,
      );
      if (!isBusy) freeCount++;
    } else {
      freeCount++;
    }
  }

  return freeCount;
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

type TimeSlot = {
  day: (typeof WEEKDAYS)[number];
  start: number;
  end: number;
};

function extractSlots(section: Section): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (const m of section.course_meetings ?? []) {
    const start = parseTimeToMins(m.begin_time);
    const end = parseTimeToMins(m.end_time);
    if (start < 0 || end <= start) continue;
    for (const day of WEEKDAYS) {
      if (m[day]) slots.push({ day, start, end });
    }
  }
  return slots;
}

function hasOverlap(existing: TimeSlot[], candidate: TimeSlot[]): boolean {
  return candidate.some((c) =>
    existing.some((e) => e.day === c.day && c.start < e.end && e.start < c.end),
  );
}

/**
 * Fetches a realistic, non-overlapping sample of real course sections from
 * the database for the initial Course Schedules timetable view.
 */
export async function getSampleScheduleSections(
  term: string = CURRENT_TERM,
): Promise<{
  shared: Section[];
  week1Only: Section[];
  week2Only: Section[];
}> {
  "use cache";
  cacheLife("hours");
  cacheTag("sections");

  const supabase = getPublicClient();

  const selectWithMeetings = `
    crn,
    subject,
    course_number,
    course_title,
    schedule_type_description,
    seats_available,
    maximum_enrollment,
    course_faculty ( display_name, primary_indicator ),
    course_meetings!inner ( building, room, begin_time, end_time, monday, tuesday, wednesday, thursday, friday )
  `;

  const [lectureRes, labTutRes] = await Promise.all([
    supabase
      .from("courses")
      .select(selectWithMeetings)
      .eq("term", term)
      .eq("schedule_type_description", "Lecture")
      .not("course_meetings.begin_time", "is", null)
      .not("course_meetings.end_time", "is", null)
      .order("subject", { ascending: true })
      .order("course_number", { ascending: true })
      .order("crn", { ascending: true })
      .limit(60),
    supabase
      .from("courses")
      .select(selectWithMeetings)
      .eq("term", term)
      .in("schedule_type_description", ["Laboratory", "Tutorial"])
      .not("course_meetings.begin_time", "is", null)
      .not("course_meetings.end_time", "is", null)
      .order("subject", { ascending: true })
      .order("course_number", { ascending: true })
      .order("crn", { ascending: true })
      .limit(40),
  ]);

  if (lectureRes.error) {
    throw new Error(`getSampleScheduleSections failed: ${lectureRes.error.message}`);
  }
  if (labTutRes.error) {
    throw new Error(`getSampleScheduleSections failed: ${labTutRes.error.message}`);
  }

  const lectures = (lectureRes.data ?? []) as unknown as Section[];
  const labTuts = (labTutRes.data ?? []) as unknown as Section[];

  const shared: Section[] = [];
  const sharedSlots: TimeSlot[] = [];
  const seenCourseCodes = new Set<string>();

  for (const sec of lectures) {
    if (shared.length >= 4) break;
    const code = `${sec.subject ?? ""} ${sec.course_number ?? ""}`.trim();
    if (!code || seenCourseCodes.has(code)) continue;
    const slots = extractSlots(sec);
    if (slots.length === 0 || hasOverlap(sharedSlots, slots)) continue;

    shared.push(sec);
    sharedSlots.push(...slots);
    seenCourseCodes.add(code);
  }

  const week1Only: Section[] = [];
  const week2Only: Section[] = [];
  const usedCrns = new Set(shared.map((s) => s.crn));

  for (const sec of labTuts) {
    if (week1Only.length >= 1 && week2Only.length >= 1) break;
    if (!sec.crn || usedCrns.has(sec.crn)) continue;
    const slots = extractSlots(sec);
    if (slots.length === 0 || hasOverlap(sharedSlots, slots)) continue;

    if (week1Only.length === 0) {
      week1Only.push(sec);
      usedCrns.add(sec.crn);
    } else if (week2Only.length === 0) {
      week2Only.push(sec);
      usedCrns.add(sec.crn);
    }
  }

  return { shared, week1Only, week2Only };
}

export type LastUpdatedInfo = {
  timestamp: string;
  source: "github-actions" | "supabase";
  actionsUrl: string;
};

const GITHUB_ACTIONS_REPO = "thomasm444/better-otu";
const GITHUB_ACTIONS_URL = `https://github.com/${GITHUB_ACTIONS_REPO}/actions`;

/**
 * Returns the most recent timestamp when data ingestion ran.
 * Prefers the latest GitHub Actions workflow run for `thomasm444/better-otu`
 * (works automatically for public repos, or private repos when `GITHUB_TOKEN`
 * is set with `actions:read`), and falls back to the latest `updated_at`
 * across the Supabase tables updated by those workflows.
 */
export async function getLastUpdatedInfo(): Promise<LastUpdatedInfo | null> {
  "use cache";
  cacheLife("minutes");

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "better-otu",
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_ACTIONS_REPO}/actions/runs?per_page=1`,
      { headers },
    );

    if (res.ok) {
      const json = (await res.json()) as {
        workflow_runs?: Array<{
          updated_at?: string;
          run_started_at?: string;
          created_at?: string;
          html_url?: string;
        }>;
      };
      const latest = json.workflow_runs?.[0];
      const ts = latest?.updated_at ?? latest?.run_started_at ?? latest?.created_at;
      if (ts && !Number.isNaN(Date.parse(ts))) {
        return {
          timestamp: ts,
          source: "github-actions",
          actionsUrl: latest?.html_url ?? GITHUB_ACTIONS_URL,
        };
      }
    }
  } catch {
    // Fall through to Supabase timestamp fallback.
  }

  try {
    const supabase = getPublicClient();
    const results = await Promise.all([
      supabase
        .from("library_study_rooms")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("room_detailed_reservations")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("courses")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("exam_schedules")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);

    let latestMs = -1;
    let latestIso: string | null = null;

    for (const res of results) {
      if (res.error) continue;
      const row = (res.data as Array<{ updated_at?: string }> | null)?.[0];
      if (!row?.updated_at) continue;
      const ms = Date.parse(row.updated_at);
      if (!Number.isNaN(ms) && ms > latestMs) {
        latestMs = ms;
        latestIso = row.updated_at;
      }
    }

    if (latestIso) {
      return {
        timestamp: latestIso,
        source: "supabase",
        actionsUrl: GITHUB_ACTIONS_URL,
      };
    }
  } catch {
    // No timestamp available.
  }

  return null;
}



import type { SupabaseClient } from "@supabase/supabase-js";

import {
  COURSE_COLOR_PALETTE,
  type BlockedTimeSlot,
  type PlannedCourseEntry,
  type ScheduleBlock,
  type ScheduleCourseGroup,
  type ScheduleTermInfo,
} from "@/app/course-schedules/types";
import type { DegreePlanRecord } from "@/lib/degree-plan-storage";
import {
  DEFAULT_START_YEAR,
  STORE_PREFIX as DEGREE_PLAN_STORAGE_PREFIX,
  catalogYearToStartYear,
  termCalendarYear,
} from "@/lib/degree-planner";
import type { PlannerTerm } from "@/lib/degree-types";

const SCHEDULE_STORAGE_PREFIX = "otu-schedule-v2:";
const BLOCKED_ROW_CODE = "__BLOCKED__";
const CUSTOM_ROW_CODE = "__CUSTOM__";

export interface LocalScheduleState {
  plannedCourses: PlannedCourseEntry[];
  blockedSlots: BlockedTimeSlot[];
  customBlocks: ScheduleBlock[];
  completedCourses: string[];
  updatedAt?: number;
}

export function loadLocalTermSchedule(
  term: string,
): LocalScheduleState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SCHEDULE_STORAGE_PREFIX + term);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalScheduleState>;
    return {
      plannedCourses: Array.isArray(parsed.plannedCourses)
        ? parsed.plannedCourses
        : [],
      blockedSlots: Array.isArray(parsed.blockedSlots)
        ? parsed.blockedSlots
        : [],
      customBlocks: Array.isArray(parsed.customBlocks)
        ? parsed.customBlocks
        : [],
      completedCourses: Array.isArray(parsed.completedCourses)
        ? parsed.completedCourses
        : [],
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function saveLocalTermSchedule(
  term: string,
  state: LocalScheduleState,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SCHEDULE_STORAGE_PREFIX + term,
      JSON.stringify({ ...state, updatedAt: Date.now() }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function resolveSelectedCrnsMap(
  course: ScheduleCourseGroup | undefined,
  crnList: string[],
): Record<string, string> {
  if (!course || crnList.length === 0) return {};
  const result: Record<string, string> = {};
  for (const crn of crnList) {
    const sec = course.sections.find((s) => s.crn === crn);
    if (sec) {
      result[sec.component] = sec.crn;
    }
  }
  return result;
}

export async function loadUserTermScheduleFromDb(
  supabase: SupabaseClient,
  userId: string,
  term: string,
  courseMap: Map<string, ScheduleCourseGroup>,
): Promise<{
  plannedCourses: PlannedCourseEntry[];
  blockedSlots: BlockedTimeSlot[];
  customBlocks: ScheduleBlock[];
  hasAnyRows: boolean;
}> {
  const { data, error } = await supabase
    .from("student_courses")
    .select("course_code, selected_crn, status, updated_at")
    .eq("user_id", userId)
    .eq("semester", term)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    course_code: string;
    selected_crn: string | null;
    status: string;
  }>;

  let blockedSlots: BlockedTimeSlot[] = [];
  let customBlocks: ScheduleBlock[] = [];
  const plannedCourses: PlannedCourseEntry[] = [];
  let colorIndex = 0;

  for (const row of rows) {
    if (row.course_code === BLOCKED_ROW_CODE) {
      if (row.selected_crn) {
        try {
          const parsed = JSON.parse(row.selected_crn);
          if (Array.isArray(parsed)) blockedSlots = parsed as BlockedTimeSlot[];
        } catch {
          // Ignore malformed JSON
        }
      }
      continue;
    }

    if (row.course_code === CUSTOM_ROW_CODE) {
      if (row.selected_crn) {
        try {
          const parsed = JSON.parse(row.selected_crn);
          if (Array.isArray(parsed)) customBlocks = parsed as ScheduleBlock[];
        } catch {
          // Ignore malformed JSON
        }
      }
      continue;
    }

    if (row.status === "dropped") continue;

    const code = row.course_code.trim().toUpperCase();
    const crns = (row.selected_crn ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    plannedCourses.push({
      courseCode: code,
      mode: "planned",
      selectedCrns: resolveSelectedCrnsMap(courseMap.get(code), crns),
      color: COURSE_COLOR_PALETTE[colorIndex % COURSE_COLOR_PALETTE.length],
    });
    colorIndex++;
  }

  return {
    plannedCourses,
    blockedSlots,
    customBlocks,
    hasAnyRows: rows.length > 0,
  };
}

export async function syncUserTermScheduleToDb(
  supabase: SupabaseClient,
  userId: string,
  term: string,
  plannedCourses: PlannedCourseEntry[],
  blockedSlots: BlockedTimeSlot[],
  customBlocks: ScheduleBlock[],
): Promise<void> {
  // Only officially planned courses (not exploring courses) sync to student_courses
  const official = plannedCourses.filter((c) => c.mode === "planned");

  const upserts: Array<{
    user_id: string;
    course_code: string;
    selected_crn: string | null;
    semester: string;
    status: string;
  }> = official.map((entry) => {
    const crns = Object.values(entry.selectedCrns)
      .map((c) => c.trim())
      .filter(Boolean);
    return {
      user_id: userId,
      course_code: entry.courseCode.trim().toUpperCase(),
      selected_crn: crns.length > 0 ? crns.join(",") : null,
      semester: term,
      status: "planned",
    };
  });

  if (blockedSlots.length > 0) {
    upserts.push({
      user_id: userId,
      course_code: BLOCKED_ROW_CODE,
      selected_crn: JSON.stringify(blockedSlots),
      semester: term,
      status: "planned",
    });
  }

  if (customBlocks.length > 0) {
    upserts.push({
      user_id: userId,
      course_code: CUSTOM_ROW_CODE,
      selected_crn: JSON.stringify(customBlocks),
      semester: term,
      status: "planned",
    });
  }

  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from("student_courses")
      .upsert(upserts, { onConflict: "user_id,course_code,semester" });
    if (upsertErr) throw upsertErr;
  }

  const keepCodes = new Set(upserts.map((u) => u.course_code));
  const { data: existing, error: fetchErr } = await supabase
    .from("student_courses")
    .select("id, course_code")
    .eq("user_id", userId)
    .eq("semester", term);

  if (fetchErr) throw fetchErr;

  const toDelete = (existing ?? [])
    .filter((row: { id: string; course_code: string }) => !keepCodes.has(row.course_code))
    .map((row: { id: string }) => row.id);

  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("student_courses")
      .delete()
      .in("id", toDelete);
    if (delErr) throw delErr;
  }
}

export function loadLocalDegreePlans(): Array<{
  programId: string;
  terms: PlannerTerm[];
  startYear: number;
}> {
  if (typeof window === "undefined") return [];
  const plans: Array<{
    programId: string;
    terms: PlannerTerm[];
    startYear: number;
  }> = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(DEGREE_PLAN_STORAGE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as
        | { terms?: PlannerTerm[]; startYear?: number }
        | PlannerTerm[];
      const terms = Array.isArray(parsed) ? parsed : parsed.terms ?? [];
      const startYear =
        !Array.isArray(parsed) && typeof parsed.startYear === "number"
          ? parsed.startYear
          : DEFAULT_START_YEAR;
      if (terms.length > 0) {
        plans.push({
          programId: key.slice(DEGREE_PLAN_STORAGE_PREFIX.length),
          terms,
          startYear,
        });
      }
    }
  } catch {
    // Ignore parse errors
  }
  return plans;
}

function seasonRank(season: "Fall" | "Winter" | "Summer"): number {
  if (season === "Winter") return 1;
  if (season === "Summer") return 2;
  return 3;
}

function termChronoKey(season: "Fall" | "Winter" | "Summer", calYear: number): number {
  return calYear * 10 + seasonRank(season);
}

export interface DegreePlanImportOption {
  id: string;
  programId: string;
  label: string;
  catalogYear: string | null;
  startYear: number;
  totalCourseCount: number;
  termCourseCodes: string[];
  completedPriorCourseCodes: string[];
  fallTermCourseCodes: string[];
  winterTermCourseCodes: string[];
}

function buildDegreePlanImportOption(
  params: {
    id: string;
    programId: string;
    label: string;
    catalogYear: string | null;
    startYear: number;
    terms: PlannerTerm[];
  },
  termInfo: ScheduleTermInfo,
): DegreePlanImportOption {
  const academicCycleStartChrono = termChronoKey("Fall", 2026);
  const termCourseCodesSet = new Set<string>();
  const fallTermCourseCodesSet = new Set<string>();
  const winterTermCourseCodesSet = new Set<string>();
  const priorRawSet = new Set<string>();
  let totalCourseCount = 0;

  for (const t of params.terms) {
    const slots = (t.slots ?? []).filter((c): c is string => Boolean(c));
    totalCourseCount += slots.length;
    const calYear = termCalendarYear(params.startYear, t.year, t.season);
    if (t.season === termInfo.season && calYear === termInfo.year) {
      for (const c of slots) termCourseCodesSet.add(c);
    }
    if (t.season === "Fall" && calYear === 2026) {
      for (const c of slots) fallTermCourseCodesSet.add(c);
    }
    if (t.season === "Winter" && calYear === 2027) {
      for (const c of slots) winterTermCourseCodesSet.add(c);
    }
    if (termChronoKey(t.season, calYear) < academicCycleStartChrono) {
      for (const c of slots) priorRawSet.add(c);
    }
  }

  const completedPriorCourseCodes = [...priorRawSet].filter(
    (c) => !termCourseCodesSet.has(c),
  );

  return {
    id: params.id,
    programId: params.programId,
    label: params.label,
    catalogYear: params.catalogYear,
    startYear: params.startYear,
    totalCourseCount,
    termCourseCodes: [...termCourseCodesSet],
    completedPriorCourseCodes,
    fallTermCourseCodes: [...fallTermCourseCodesSet],
    winterTermCourseCodes: [...winterTermCourseCodesSet],
  };
}

export function extractAllDegreePlansForTerm(
  remotePlans: DegreePlanRecord[],
  termInfo: ScheduleTermInfo,
): DegreePlanImportOption[] {
  const options: DegreePlanImportOption[] = [];
  const seenProgramIds = new Set<string>();

  for (const rp of remotePlans) {
    if (!Array.isArray(rp.terms) || rp.terms.length === 0) continue;
    seenProgramIds.add(rp.program_id);
    const startYear =
      rp.start_year ??
      (rp.catalog_year ? catalogYearToStartYear(rp.catalog_year) : null) ??
      DEFAULT_START_YEAR;
    options.push(
      buildDegreePlanImportOption(
        {
          id: rp.id || `remote:${rp.program_id}`,
          programId: rp.program_id,
          label: rp.degree_name || `Program ${rp.program_id}`,
          catalogYear: rp.catalog_year ?? null,
          startYear,
          terms: rp.terms,
        },
        termInfo,
      ),
    );
  }

  const localPlans = loadLocalDegreePlans();
  for (const lp of localPlans) {
    if (seenProgramIds.has(lp.programId)) continue;
    seenProgramIds.add(lp.programId);
    options.push(
      buildDegreePlanImportOption(
        {
          id: `local:${lp.programId}`,
          programId: lp.programId,
          label:
            localPlans.length > 1 && lp.programId
              ? `Saved Plan (${lp.programId})`
              : "Saved Degree Plan",
          catalogYear: null,
          startYear: lp.startYear,
          terms: lp.terms,
        },
        termInfo,
      ),
    );
  }

  return options;
}

export function extractTermFromDegreePlans(
  remotePlans: DegreePlanRecord[],
  termInfo: ScheduleTermInfo,
): {
  termCourseCodes: string[];
  completedPriorCourseCodes: string[];
  sourceLabel: string | null;
} {
  const options = extractAllDegreePlansForTerm(remotePlans, termInfo);
  const withTermCourses = options.find((o) => o.termCourseCodes.length > 0);
  if (withTermCourses) {
    return {
      termCourseCodes: withTermCourses.termCourseCodes,
      completedPriorCourseCodes: withTermCourses.completedPriorCourseCodes,
      sourceLabel: withTermCourses.label,
    };
  }

  const withCompleted = options.find(
    (o) => o.completedPriorCourseCodes.length > 0,
  );
  if (withCompleted) {
    return {
      termCourseCodes: [],
      completedPriorCourseCodes: withCompleted.completedPriorCourseCodes,
      sourceLabel: withCompleted.label,
    };
  }

  return {
    termCourseCodes: [],
    completedPriorCourseCodes: [],
    sourceLabel: null,
  };
}

import { getTorontoNowParts } from "@/lib/campus-map-dates";
import type { ElectiveMatch, PrereqAstNode } from "@/lib/degree-types";
import type { Section } from "@/lib/queries";

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const DAYS_OF_WEEK: { key: DayOfWeek; shortLabel: string; fullLabel: string }[] = [
  { key: "monday", shortLabel: "Mon", fullLabel: "Monday" },
  { key: "tuesday", shortLabel: "Tue", fullLabel: "Tuesday" },
  { key: "wednesday", shortLabel: "Wed", fullLabel: "Wednesday" },
  { key: "thursday", shortLabel: "Thu", fullLabel: "Thursday" },
  { key: "friday", shortLabel: "Fri", fullLabel: "Friday" },
  { key: "saturday", shortLabel: "Sat", fullLabel: "Saturday" },
  { key: "sunday", shortLabel: "Sun", fullLabel: "Sunday" },
];

export type ColorTheme =
  | "blue"
  | "indigo"
  | "purple"
  | "rose"
  | "amber"
  | "emerald"
  | "cyan"
  | "teal"
  | "orange";

export const COURSE_COLOR_PALETTE: ColorTheme[] = [
  "blue",
  "emerald",
  "purple",
  "amber",
  "indigo",
  "cyan",
  "teal",
  "orange",
  "rose",
];

export type WeekPattern = "both" | "week1" | "week2";
export type ScheduleViewMode = "combined" | "week1" | "week2";
export type CourseComponentType = "LEC" | "LAB" | "TUT" | "SEM" | "OTHER";
export type DeliveryMode = "in_person" | "online_sync" | "online_async" | "hybrid";

export interface ScheduleTermInfo {
  code: string;
  label: string;
  season: "Fall" | "Winter" | "Summer";
  year: number;
}

export const SCHEDULE_TERMS: ScheduleTermInfo[] = [
  { code: "202609", label: "Fall 2026", season: "Fall", year: 2026 },
  { code: "202701", label: "Winter 2027", season: "Winter", year: 2027 },
  { code: "202605", label: "Spring/Summer 2026", season: "Summer", year: 2026 },
];

export function getDefaultScheduleTerm(now: Date = new Date()): string {
  const { date } = getTorontoNowParts(now);
  if (date >= "2027-01-01" && date <= "2027-04-30") return "202701";
  if (date >= "2026-05-01" && date <= "2026-08-20") return "202605";
  return "202609";
}

export interface NormalizedMeetingSlot {
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  room: string | null;
  building: string | null;
  location: string;
  weekPattern: WeekPattern;
  dates: string[];
}

export interface SectionRmpInfo {
  legacyId: number | null;
  fullName: string;
  avgRating: number | null;
  avgDifficulty: number | null;
  numRatings: number;
  wouldTakeAgainPercent: number | null;
}

export interface ScheduleSection {
  crn: string;
  subject: string;
  courseNumber: string;
  courseCode: string;
  title: string;
  sequenceNumber: string | null;
  scheduleTypeDescription: string | null;
  component: CourseComponentType;
  linkIdentifier: string | null;
  linkGroup: string | null;
  instructionalMethod: string | null;
  instructionalMethodDescription: string | null;
  campusDescription: string | null;
  deliveryMode: DeliveryMode;
  isOnline: boolean;
  isAsync: boolean;
  seatsAvailable: number | null;
  maximumEnrollment: number | null;
  openSection: boolean;
  creditHours: number | null;
  instructor: string | null;
  rmp?: SectionRmpInfo | null;
  weekPattern: WeekPattern;
  meetings: NormalizedMeetingSlot[];
}

export interface ScheduleCourseGroup {
  courseCode: string;
  subject: string;
  courseNumber: string;
  title: string;
  faculty: string | null;
  subjectName: string | null;
  level: number;
  creditHours: number;
  description: string | null;
  prerequisiteText: string | null;
  prerequisiteCodes: string[];
  prerequisiteAst: PrereqAstNode | null;
  formerlyCodes: string[];
  hoursLecture: string | null;
  hoursLaboratory: string | null;
  hoursTutorial: string | null;
  sections: ScheduleSection[];
  requiredComponents: CourseComponentType[];
  isLectureOnly: boolean;
  isFullyOnlineCapable: boolean;
  isFullyAsyncCapable: boolean;
  hasOpenSeats: boolean;
  hasBiweeklyComponent: boolean;
}

export interface ElectivePreset {
  id: string;
  label: string;
  description: string;
  match: ElectiveMatch;
}

export const ELECTIVE_PRESETS: ElectivePreset[] = [
  {
    id: "science",
    label: "Science Electives",
    description: "Courses in Faculty of Science subjects (BIOL, CHEM, CSCI, MATH, PHY, STAT, etc.)",
    match: {
      label: "Science",
      subjects: [
        "APBS",
        "BIOL",
        "CHEM",
        "CSCI",
        "ENVS",
        "FSCI",
        "IMCS",
        "MATH",
        "MCSC",
        "MTSC",
        "NSCI",
        "PHY",
        "SCCO",
        "SCIE",
        "SIMU",
        "STAT",
      ],
    },
  },
  {
    id: "science-3000",
    label: "Science Electives (3000+)",
    description: "Upper-year 3000/4000-level Science electives",
    match: {
      label: "Science 3000+",
      subjects: [
        "APBS",
        "BIOL",
        "CHEM",
        "CSCI",
        "ENVS",
        "FSCI",
        "IMCS",
        "MATH",
        "MCSC",
        "MTSC",
        "NSCI",
        "PHY",
        "SCCO",
        "SCIE",
        "SIMU",
        "STAT",
      ],
      min_level: 3000,
    },
  },
  {
    id: "ssh",
    label: "Social Science & Humanities",
    description: "Faculty of Social Science & Humanities electives (COMM, CRMN, LGLS, POSC, PSYC, etc.)",
    match: {
      label: "Social Science and Humanities",
      faculties: ["Faculty of Social Science and Humanities"],
    },
  },
  {
    id: "ssh-2000",
    label: "Social Science & Humanities (2000+)",
    description: "2000-level and above Social Science & Humanities electives",
    match: {
      label: "Social Science and Humanities 2000+",
      faculties: ["Faculty of Social Science and Humanities"],
      min_level: 2000,
    },
  },
  {
    id: "business",
    label: "Business & IT Electives",
    description: "Faculty of Business and Information Technology courses (BUSI, INFR, etc.)",
    match: {
      label: "Business & IT",
      faculties: ["Faculty of Business and Information Technology"],
    },
  },
  {
    id: "engineering",
    label: "Engineering Electives",
    description: "Engineering courses (ARTE, AUTE, ELEE, ENEE, ENGR, INSE, MANE, MECE, METE, SOFE)",
    match: {
      label: "Engineering",
      subjects: [
        "ARTE",
        "AUTE",
        "ELEE",
        "ENEE",
        "ENGR",
        "INSE",
        "MANE",
        "MECE",
        "METE",
        "SOFE",
      ],
    },
  },
  {
    id: "csci",
    label: "Computer Science (CSCI)",
    description: "All Computer Science courses",
    match: { label: "CSCI", subjects: ["CSCI"] },
  },
  {
    id: "csci-3000",
    label: "Computer Science (3000+)",
    description: "Upper-year Computer Science electives",
    match: { label: "CSCI 3000+", subjects: ["CSCI"], min_level: 3000 },
  },
  {
    id: "math-stat",
    label: "Math & Statistics",
    description: "MATH and STAT courses",
    match: { label: "MATH / STAT", subjects: ["MATH", "STAT"] },
  },
  {
    id: "health-kine",
    label: "Health Sciences & Kinesiology",
    description: "HLSC, KINE, MLSC, and NURS courses",
    match: { label: "Health & Kine", subjects: ["HLSC", "KINE", "MLSC", "NURS"] },
  },
  {
    id: "comm",
    label: "Communication (COMM)",
    description: "Communication & Digital Media Studies electives",
    match: { label: "COMM", subjects: ["COMM"] },
  },
  {
    id: "lgls",
    label: "Legal Studies (LGLS)",
    description: "Legal Studies electives",
    match: { label: "LGLS", subjects: ["LGLS"] },
  },
  {
    id: "level-3000",
    label: "Any 3000+ Upper-Year",
    description: "Any 3000 or 4000-level course across all faculties",
    match: { label: "3000+", min_level: 3000 },
  },
  {
    id: "level-4000",
    label: "Any 4000+ Fourth-Year",
    description: "Any 4000-level course across all faculties",
    match: { label: "4000+", min_level: 4000 },
  },
];

export interface TermScheduleCatalog {
  term: string;
  termLabel: string;
  courses: ScheduleCourseGroup[];
  subjects: string[];
  instructors: string[];
  deliveryStats: {
    totalCourses: number;
    onlineCourses: number;
    asyncCourses: number;
    lectureOnlyCourses: number;
    biweeklyCourses: number;
  };
}

export interface ScheduleBlock {
  /** Unique identifier for the block */
  id: string;
  /** Course subject and code, e.g. "CSCI 1030U" */
  courseCode: string;
  /** Full course title, e.g. "Introduction to Computer Science" */
  title: string;
  /** Delivery type, e.g. "LEC", "LAB", "TUT" */
  type?: string;
  /** Normalized component */
  component?: CourseComponentType;
  /** Course reference number */
  crn?: string;
  /** Building & room, e.g. "SCI 1350" */
  room?: string;
  /** Instructor display name */
  instructor?: string;
  /** Matched RateMyProfessors summary for the section's instructor */
  rmp?: SectionRmpInfo | null;
  /** Day of the week */
  day: DayOfWeek;
  /** Start time in 24h format (HH:MM) or ISO time string, e.g. "08:10" or "08:10:00" */
  startTime: string;
  /** End time in 24h format (HH:MM) or ISO time string, e.g. "09:30" or "09:30:00" */
  endTime: string;
  /** Biweekly recurrence pattern */
  weekPattern: WeekPattern;
  /** Planned vs exploring vs hover preview */
  mode?: "planned" | "exploring" | "preview";
  /** Delivery mode */
  deliveryMode?: DeliveryMode;
  /** Color theme for styling the spreadsheet block */
  color?: ColorTheme;
  /** Conflict markers computed by annotateScheduleConflicts */
  isConflict?: boolean;
  conflictWith?: string[];
  /** Custom user-created block */
  isCustom?: boolean;
  /** Optional notes */
  notes?: string;
}

export interface PlannedCourseEntry {
  courseCode: string;
  mode: "planned" | "exploring";
  selectedCrns: Record<string, string>;
  color: ColorTheme;
  hidden?: boolean;
}

export interface BlockedTimeSlot {
  id: string;
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  label: string;
}

export type SectionGridPickerComponent = CourseComponentType | "ALL";

export interface SectionGridPickerTarget {
  courseCode: string;
  component: SectionGridPickerComponent;
}

export interface WeekScheduleProps {
  /** View mode controlling combined biweekly side-by-side vs single week */
  viewMode: "combined" | "week1" | "week2";
  /** Display title */
  title: string;
  /** Subtitle or description */
  subtitle?: string;
  /** List of course blocks */
  courses: ScheduleBlock[];
  /** Blocked off time slots */
  blockedSlots?: BlockedTimeSlot[];
  /** Course catalog map for drag-to-snap ghost targets */
  courseMap?: Map<string, ScheduleCourseGroup>;
  /** Active course+component whose sections are displayed on the grid for click-to-schedule */
  gridSectionPicker?: SectionGridPickerTarget | null;
  /** Callback to open/switch or close the grid section picker overlay */
  onChangeGridSectionPicker?: (target: SectionGridPickerTarget | null) => void;
  /** Whether edit mode is active */
  isEditMode?: boolean;
  /** Earliest start hour on the grid (default: 8 = 8:00 AM) */
  startHour?: number;
  /** Latest end hour on the grid (default: 22 = 10:00 PM) */
  endHour?: number;
  /** Callback when user wants to remove a block or component */
  onRemoveBlock?: (block: ScheduleBlock) => void;
  /** Callback when user drags a course block to snap to another section */
  onSelectSection?: (
    courseCode: string,
    component: CourseComponentType,
    crn: string,
  ) => void;
  /** Callback to promote an exploring course to planned */
  onPromoteCourse?: (courseCode: string) => void;
  /** Callback to focus a course in the right-hand lookup panel */
  onInspectCourse?: (courseCode: string) => void;
  /** Callback when user removes a blocked slot */
  onRemoveBlockedSlot?: (id: string) => void;
  /** Callback to update blocked slots (drag create/move/resize + auto-merge) */
  onUpdateBlockedSlots?: (
    updater: (prev: BlockedTimeSlot[]) => BlockedTimeSlot[],
  ) => void;
  /** Interactive click/drag-to-block mode */
  isBlockingMode?: boolean;
  /** Callback when user creates a blocked slot */
  onCreateBlockedSlot?: (
    day: DayOfWeek,
    startTime: string,
    endTime: string,
    label?: string,
  ) => void;
  /** Accent color for header badge */
  accentColor?: "blue" | "purple" | "emerald" | "amber" | "rose" | "red";
  /** Week label badge text */
  badgeLabel?: string;
  /** Whether the grid stretches to fit without scrolling (default: true) */
  fitToHeight?: boolean;
}

export const THEME_STYLES: Record<
  ColorTheme,
  {
    bg: string;
    border: string;
    text: string;
    accent: string;
    hoverBg: string;
  }
> = {
  blue: {
    bg: "bg-blue-50/90 dark:bg-blue-950/60",
    border: "border-blue-300 dark:border-blue-700/80",
    text: "text-blue-900 dark:text-blue-100",
    accent: "bg-blue-500",
    hoverBg: "hover:bg-blue-100/90 dark:hover:bg-blue-900/70",
  },
  indigo: {
    bg: "bg-indigo-50/90 dark:bg-indigo-950/60",
    border: "border-indigo-300 dark:border-indigo-700/80",
    text: "text-indigo-900 dark:text-indigo-100",
    accent: "bg-indigo-500",
    hoverBg: "hover:bg-indigo-100/90 dark:hover:bg-indigo-900/70",
  },
  purple: {
    bg: "bg-purple-50/90 dark:bg-purple-950/60",
    border: "border-purple-300 dark:border-purple-700/80",
    text: "text-purple-900 dark:text-purple-100",
    accent: "bg-purple-500",
    hoverBg: "hover:bg-purple-100/90 dark:hover:bg-purple-900/70",
  },
  rose: {
    bg: "bg-rose-50/90 dark:bg-rose-950/60",
    border: "border-rose-300 dark:border-rose-700/80",
    text: "text-rose-900 dark:text-rose-100",
    accent: "bg-rose-500",
    hoverBg: "hover:bg-rose-100/90 dark:hover:bg-rose-900/70",
  },
  amber: {
    bg: "bg-amber-50/90 dark:bg-amber-950/60",
    border: "border-amber-300 dark:border-amber-700/80",
    text: "text-amber-900 dark:text-amber-100",
    accent: "bg-amber-500",
    hoverBg: "hover:bg-amber-100/90 dark:hover:bg-amber-900/70",
  },
  emerald: {
    bg: "bg-emerald-50/90 dark:bg-emerald-950/60",
    border: "border-emerald-300 dark:border-emerald-700/80",
    text: "text-emerald-900 dark:text-emerald-100",
    accent: "bg-emerald-500",
    hoverBg: "hover:bg-emerald-100/90 dark:hover:bg-emerald-900/70",
  },
  cyan: {
    bg: "bg-cyan-50/90 dark:bg-cyan-950/60",
    border: "border-cyan-300 dark:border-cyan-700/80",
    text: "text-cyan-900 dark:text-cyan-100",
    accent: "bg-cyan-500",
    hoverBg: "hover:bg-cyan-100/90 dark:hover:bg-cyan-900/70",
  },
  teal: {
    bg: "bg-teal-50/90 dark:bg-teal-950/60",
    border: "border-teal-300 dark:border-teal-700/80",
    text: "text-teal-900 dark:text-teal-100",
    accent: "bg-teal-500",
    hoverBg: "hover:bg-teal-100/90 dark:hover:bg-teal-900/70",
  },
  orange: {
    bg: "bg-orange-50/90 dark:bg-orange-950/60",
    border: "border-orange-300 dark:border-orange-700/80",
    text: "text-orange-900 dark:text-orange-100",
    accent: "bg-orange-500",
    hoverBg: "hover:bg-orange-100/90 dark:hover:bg-orange-900/70",
  },
};

/**
 * Converts a string like "08:10", "08:10:00", or "8:10 AM" into total minutes from midnight.
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;

  const trimmed = timeStr.trim().toLowerCase();
  const isPM = trimmed.includes("pm");
  const isAM = trimmed.includes("am");
  const clean = trimmed.replace(/[apm\s]/g, "");
  const parts = clean.split(":");
  let hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;

  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

export function minutesToTimeString(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Formats time from 24h string ("08:10") to display format ("8:10 AM").
 */
export function formatTimeDisplay(timeStr: string): string {
  if (!timeStr) return "";
  const minutes = parseTimeToMinutes(timeStr);
  const hour24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${mins.toString().padStart(2, "0")} ${period}`;
}

/**
 * Formats an integer hour (8..21) into label ("8 AM", "12 PM", "9 PM")
 */
export function formatHourLabel(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

function formatScheduleType(description: string | null): string {
  if (!description) return "LEC";
  const lower = description.toLowerCase();
  if (lower === "lecture" || lower === "lecture & lab") return "LEC";
  if (lower === "laboratory" || lower === "lab" || lower === "lab only") return "LAB";
  if (lower === "tutorial") return "TUT";
  if (lower === "seminar") return "SEM";
  return description;
}

/**
 * Legacy helper kept for backward compatibility.
 */
export function convertSectionToScheduleBlocks(
  section: Section,
  color: ColorTheme = "blue",
): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = [];
  const seen = new Set<string>();
  const faculty =
    section.course_faculty?.find((f) => f.primary_indicator) ??
    section.course_faculty?.[0];
  const meetings = section.course_meetings ?? [];
  const shortType = formatScheduleType(section.schedule_type_description);

  for (let i = 0; i < meetings.length; i++) {
    const meeting = meetings[i];
    if (!meeting.begin_time || !meeting.end_time) continue;

    const building = meeting.building ?? "";
    const room = meeting.room ?? "";
    const location =
      building && room.startsWith(building)
        ? room
        : [building, room].filter(Boolean).join(" ");

    const activeDays: DayOfWeek[] = [];
    if (meeting.monday) activeDays.push("monday");
    if (meeting.tuesday) activeDays.push("tuesday");
    if (meeting.wednesday) activeDays.push("wednesday");
    if (meeting.thursday) activeDays.push("thursday");
    if (meeting.friday) activeDays.push("friday");
    const weekend = meeting as typeof meeting & {
      saturday?: boolean;
      sunday?: boolean;
    };
    if (weekend.saturday) activeDays.push("saturday");
    if (weekend.sunday) activeDays.push("sunday");

    for (const day of activeDays) {
      const dedupeKey = `${day}|${meeting.begin_time}|${meeting.end_time}|${location}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      blocks.push({
        id: `${section.crn}-${day}-${meeting.begin_time}-${i}`,
        courseCode: `${section.subject} ${section.course_number}`,
        title: section.course_title ?? "Untitled Course",
        type: shortType,
        crn: section.crn ?? undefined,
        room: location || undefined,
        instructor: faculty?.display_name ?? undefined,
        day,
        startTime: meeting.begin_time,
        endTime: meeting.end_time,
        weekPattern: "both",
        color,
      });
    }
  }

  return blocks;
}

export function convertScheduleSectionToBlocks(
  section: ScheduleSection,
  color: ColorTheme = "blue",
  mode: "planned" | "exploring" | "preview" = "planned",
): ScheduleBlock[] {
  return section.meetings.map((m, idx) => ({
    id: `${mode}-${section.courseCode}-${section.crn}-${m.day}-${m.startTime}-${idx}`,
    courseCode: section.courseCode,
    title: section.title,
    type: section.component,
    component: section.component,
    crn: section.crn,
    room: m.location || (section.isOnline ? "Online" : undefined),
    instructor: section.instructor ?? undefined,
    rmp: section.rmp ?? null,
    day: m.day,
    startTime: m.startTime,
    endTime: m.endTime,
    weekPattern: m.weekPattern,
    mode,
    deliveryMode: section.deliveryMode,
    color,
  }));
}

export function weeksConflict(a: WeekPattern, b: WeekPattern): boolean {
  if ((a === "week1" && b === "week2") || (a === "week2" && b === "week1")) {
    return false;
  }
  return true;
}

export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function checkSectionFit(
  section: ScheduleSection,
  activeBlocks: ScheduleBlock[],
  blockedSlots: BlockedTimeSlot[],
  ignoreCourseCode?: string,
  ignoreComponent?: string,
): {
  fits: boolean;
  conflictsWith: string[];
  pairedBiweeklyWith: string[];
} {
  const conflicts = new Set<string>();
  const paired = new Set<string>();

  for (const m of section.meetings) {
    for (const blocked of blockedSlots) {
      if (blocked.day !== m.day) continue;
      const bStart = parseTimeToMinutes(blocked.startTime);
      const bEnd = parseTimeToMinutes(blocked.endTime);
      if (intervalsOverlap(m.startMinutes, m.endMinutes, bStart, bEnd)) {
        conflicts.add(blocked.label || "Blocked Time");
      }
    }

    for (const block of activeBlocks) {
      if (block.mode === "preview") continue;
      if (
        ignoreCourseCode &&
        block.courseCode === ignoreCourseCode &&
        (!ignoreComponent || block.component === ignoreComponent)
      ) {
        continue;
      }
      if (block.day !== m.day) continue;
      const bStart = parseTimeToMinutes(block.startTime);
      const bEnd = parseTimeToMinutes(block.endTime);
      if (!intervalsOverlap(m.startMinutes, m.endMinutes, bStart, bEnd)) {
        continue;
      }

      if (weeksConflict(m.weekPattern, block.weekPattern)) {
        conflicts.add(
          `${block.courseCode}${block.type ? ` (${block.type})` : ""}`,
        );
      } else {
        paired.add(
          `${block.courseCode}${block.type ? ` (${block.type})` : ""}`,
        );
      }
    }
  }

  return {
    fits: conflicts.size === 0,
    conflictsWith: [...conflicts],
    pairedBiweeklyWith: [...paired],
  };
}

function getCourseSectionsByComponent(course: ScheduleCourseGroup) {
  const byComp = new Map<CourseComponentType, ScheduleSection[]>();
  for (const sec of course.sections) {
    const list = byComp.get(sec.component) ?? [];
    list.push(sec);
    byComp.set(sec.component, list);
  }
  return byComp;
}

export function areCourseSectionsLinkCompatible(
  selected: ScheduleSection[],
  byComp: Map<CourseComponentType, ScheduleSection[]>,
): boolean {
  for (let i = 0; i < selected.length; i++) {
    const a = selected[i];
    if (!a.linkGroup) continue;
    for (let j = i + 1; j < selected.length; j++) {
      const b = selected[j];
      if (!b.linkGroup || a.linkGroup === b.linkGroup) continue;
      const bPool = byComp.get(b.component) ?? [];
      const aPool = byComp.get(a.component) ?? [];
      const bSupportsA = bPool.some((s) => s.linkGroup === a.linkGroup);
      const aSupportsB = aPool.some((s) => s.linkGroup === b.linkGroup);
      if (bSupportsA || aSupportsB) {
        return false;
      }
    }
  }
  return true;
}

export function getSingleSectionCrnsForCourse(
  course: ScheduleCourseGroup,
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const comp of course.requiredComponents) {
    const compSections = course.sections.filter((s) => s.component === comp);
    if (compSections.length === 1) {
      selected[comp] = compSections[0].crn;
    }
  }
  return selected;
}

export function findValidSectionComboForCourse(
  course: ScheduleCourseGroup,
  activeBlocks: ScheduleBlock[],
  blockedSlots: BlockedTimeSlot[],
  options?: {
    currentSelections?: Record<string, string>;
    requireOnline?: boolean;
    requireAsync?: boolean;
    requireOpenSeats?: boolean;
    ignoreCourseCode?: string;
    allowConflictingFallback?: boolean;
  },
): Record<string, string> | null {
  const components = course.requiredComponents;
  if (components.length === 0) return {};

  const byComp = getCourseSectionsByComponent(course);
  const candidatesByComp = components.map((comp) => {
    const all = byComp.get(comp) ?? [];
    let filtered = all.filter((sec) => {
      if (options?.requireAsync && !sec.isAsync) return false;
      if (options?.requireOnline && !sec.isOnline) return false;
      if (
        options?.requireOpenSeats &&
        sec.seatsAvailable !== null &&
        sec.seatsAvailable <= 0
      ) {
        return false;
      }
      return true;
    });

    const preferredCrn = options?.currentSelections?.[comp];
    filtered = filtered.slice().sort((a, b) => {
      if (preferredCrn) {
        if (a.crn === preferredCrn) return -1;
        if (b.crn === preferredCrn) return 1;
      }
      const aOpen = (a.seatsAvailable ?? 1) > 0 ? 0 : 1;
      const bOpen = (b.seatsAvailable ?? 1) > 0 ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return a.crn.localeCompare(b.crn);
    });

    const fitting = filtered.filter(
      (sec) =>
        checkSectionFit(
          sec,
          activeBlocks,
          blockedSlots,
          options?.ignoreCourseCode ?? course.courseCode,
        ).fits,
    );

    return { comp, fitting, allFiltered: filtered };
  });

  if (candidatesByComp.some((c) => c.allFiltered.length === 0)) {
    return null;
  }

  // Try strict conflict-free backtracking first
  if (candidatesByComp.every((c) => c.fitting.length > 0)) {
    const picked: ScheduleSection[] = [];
    const search = (idx: number, extraBlocks: ScheduleBlock[]): Record<string, string> | null => {
      if (idx === candidatesByComp.length) {
        if (!areCourseSectionsLinkCompatible(picked, byComp)) return null;
        const out: Record<string, string> = {};
        for (const s of picked) out[s.component] = s.crn;
        return out;
      }
      const { fitting } = candidatesByComp[idx];
      for (const sec of fitting) {
        const selfCheck = checkSectionFit(sec, extraBlocks, []);
        if (!selfCheck.fits) continue;
        picked.push(sec);
        const secBlocks = convertScheduleSectionToBlocks(sec, "blue", "planned");
        const found = search(idx + 1, [...extraBlocks, ...secBlocks]);
        if (found) return found;
        picked.pop();
      }
      return null;
    };

    const strictResult = search(0, []);
    if (strictResult) return strictResult;
  }

  if (!options?.allowConflictingFallback) {
    return null;
  }

  // Fallback: return first link-compatible set even if a conflict exists
  const picked: ScheduleSection[] = [];
  for (const { allFiltered } of candidatesByComp) {
    const match =
      allFiltered.find((sec) =>
        areCourseSectionsLinkCompatible([...picked, sec], byComp),
      ) ?? allFiltered[0];
    if (match) picked.push(match);
  }
  const out: Record<string, string> = {};
  for (const s of picked) out[s.component] = s.crn;
  return out;
}

export function autoFitPlannedCourses(
  entries: PlannedCourseEntry[],
  courseMap: Map<string, ScheduleCourseGroup>,
  blockedSlots: BlockedTimeSlot[],
  customBlocks: ScheduleBlock[] = [],
): Record<string, Record<string, string>> | null {
  const activeEntries = entries.filter((e) => !e.hidden);
  const resolved = activeEntries
    .map((entry) => ({
      entry,
      course: courseMap.get(entry.courseCode),
    }))
    .filter(
      (item): item is { entry: PlannedCourseEntry; course: ScheduleCourseGroup } =>
        Boolean(item.course),
    );

  // Order most-constrained first (fewest sections across required components)
  resolved.sort((a, b) => {
    const countA = a.course.sections.length;
    const countB = b.course.sections.length;
    return countA - countB;
  });

  const assignments: Record<string, Record<string, string>> = {};
  const runningBlocks: ScheduleBlock[] = customBlocks.filter(
    (b) => b.mode !== "preview",
  );

  // Keep exploring entries' fixed CRNs as constraints or solve necessary ones first
  const search = (idx: number, currentBlocks: ScheduleBlock[]): boolean => {
    if (idx === resolved.length) return true;
    const { entry, course } = resolved[idx];
    const byComp = getCourseSectionsByComponent(course);
    const comps = course.requiredComponents;

    if (comps.length === 0) {
      assignments[course.courseCode] = {};
      return search(idx + 1, currentBlocks);
    }

    // Generate up to 24 valid combos for this course against currentBlocks
    const combos: { map: Record<string, string>; blocks: ScheduleBlock[] }[] = [];
    const picked: ScheduleSection[] = [];

    const collectCombos = (cIdx: number, localBlocks: ScheduleBlock[]) => {
      if (combos.length >= 24) return;
      if (cIdx === comps.length) {
        if (!areCourseSectionsLinkCompatible(picked, byComp)) return;
        const map: Record<string, string> = {};
        for (const s of picked) map[s.component] = s.crn;
        combos.push({ map, blocks: localBlocks });
        return;
      }
      const comp = comps[cIdx];
      const preferred = entry.selectedCrns[comp];
      const pool = (byComp.get(comp) ?? []).slice().sort((a, b) => {
        if (preferred) {
          if (a.crn === preferred) return -1;
          if (b.crn === preferred) return 1;
        }
        return (b.seatsAvailable ?? 0) - (a.seatsAvailable ?? 0);
      });

      for (const sec of pool) {
        const fit = checkSectionFit(
          sec,
          [...currentBlocks, ...localBlocks],
          blockedSlots,
        );
        if (!fit.fits) continue;
        picked.push(sec);
        const secBlocks = convertScheduleSectionToBlocks(sec, entry.color, entry.mode);
        collectCombos(cIdx + 1, [...localBlocks, ...secBlocks]);
        picked.pop();
        if (combos.length >= 24) break;
      }
    };

    collectCombos(0, []);

    for (const combo of combos) {
      assignments[course.courseCode] = combo.map;
      if (search(idx + 1, [...currentBlocks, ...combo.blocks])) {
        return true;
      }
    }

    return false;
  };

  if (search(0, runningBlocks)) {
    return assignments;
  }
  return null;
}

export function annotateScheduleConflicts(
  blocks: ScheduleBlock[],
  blockedSlots: BlockedTimeSlot[],
): ScheduleBlock[] {
  return blocks.map((block) => {
    if (block.mode === "preview") return block;
    const bStart = parseTimeToMinutes(block.startTime);
    const bEnd = parseTimeToMinutes(block.endTime);
    const conflicts = new Set<string>();

    for (const blocked of blockedSlots) {
      if (blocked.day !== block.day) continue;
      const sStart = parseTimeToMinutes(blocked.startTime);
      const sEnd = parseTimeToMinutes(blocked.endTime);
      if (intervalsOverlap(bStart, bEnd, sStart, sEnd)) {
        conflicts.add(blocked.label || "Blocked Time");
      }
    }

    for (const other of blocks) {
      if (other.id === block.id || other.mode === "preview") continue;
      if (other.day !== block.day) continue;
      if (
        other.courseCode === block.courseCode &&
        other.crn &&
        block.crn &&
        other.crn === block.crn
      ) {
        continue;
      }
      const oStart = parseTimeToMinutes(other.startTime);
      const oEnd = parseTimeToMinutes(other.endTime);
      if (!intervalsOverlap(bStart, bEnd, oStart, oEnd)) continue;
      if (weeksConflict(block.weekPattern, other.weekPattern)) {
        conflicts.add(
          `${other.courseCode}${other.type ? ` (${other.type})` : ""}`,
        );
      }
    }

    return {
      ...block,
      isConflict: conflicts.size > 0,
      conflictWith: conflicts.size > 0 ? [...conflicts] : undefined,
    };
  });
}

/**
 * Merges overlapping or contiguous blocked time slots on the same day into one block.
 */
export function mergeBlockedSlots(
  slots: BlockedTimeSlot[],
): BlockedTimeSlot[] {
  const byDay = new Map<DayOfWeek, BlockedTimeSlot[]>();
  for (const slot of slots) {
    const start = parseTimeToMinutes(slot.startTime);
    const end = parseTimeToMinutes(slot.endTime);
    if (end <= start) continue;
    const list = byDay.get(slot.day) ?? [];
    list.push({
      ...slot,
      startTime: minutesToTimeString(start),
      endTime: minutesToTimeString(end),
    });
    byDay.set(slot.day, list);
  }

  const merged: BlockedTimeSlot[] = [];
  for (const dayMeta of DAYS_OF_WEEK) {
    const daySlots = byDay.get(dayMeta.key);
    if (!daySlots || daySlots.length === 0) continue;

    daySlots.sort(
      (a, b) =>
        parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime) ||
        parseTimeToMinutes(a.endTime) - parseTimeToMinutes(b.endTime),
    );

    let cur = { ...daySlots[0] };
    let curStart = parseTimeToMinutes(cur.startTime);
    let curEnd = parseTimeToMinutes(cur.endTime);

    for (let i = 1; i < daySlots.length; i++) {
      const next = daySlots[i];
      const nextStart = parseTimeToMinutes(next.startTime);
      const nextEnd = parseTimeToMinutes(next.endTime);

      if (nextStart <= curEnd) {
        curEnd = Math.max(curEnd, nextEnd);
        curStart = Math.min(curStart, nextStart);
        cur.startTime = minutesToTimeString(curStart);
        cur.endTime = minutesToTimeString(curEnd);

        const labels = new Set<string>();
        for (const lbl of [cur.label, next.label]) {
          const clean = (lbl ?? "").trim();
          if (clean && clean !== "Blocked") {
            for (const part of clean.split(" / ")) {
              if (part.trim()) labels.add(part.trim());
            }
          }
        }
        cur.label = labels.size > 0 ? [...labels].join(" / ") : "Blocked";
      } else {
        merged.push(cur);
        cur = { ...next };
        curStart = nextStart;
        curEnd = nextEnd;
      }
    }
    merged.push(cur);
  }

  return merged;
}

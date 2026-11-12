import type { Section } from "@/lib/queries";

export type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";

export const DAYS_OF_WEEK: { key: DayOfWeek; shortLabel: string; fullLabel: string }[] = [
  { key: "monday", shortLabel: "Mon", fullLabel: "Monday" },
  { key: "tuesday", shortLabel: "Tue", fullLabel: "Tuesday" },
  { key: "wednesday", shortLabel: "Wed", fullLabel: "Wednesday" },
  { key: "thursday", shortLabel: "Thu", fullLabel: "Thursday" },
  { key: "friday", shortLabel: "Fri", fullLabel: "Friday" },
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

export interface ScheduleBlock {
  /** Unique identifier for the block */
  id: string;
  /** Course subject and code, e.g. "CSCI 1030U" */
  courseCode: string;
  /** Full course title, e.g. "Introduction to Computer Science" */
  title: string;
  /** Delivery type, e.g. "LEC", "LAB", "TUT" */
  type?: string;
  /** Course reference number */
  crn?: string;
  /** Building & room, e.g. "SCI 1350" */
  room?: string;
  /** Instructor display name */
  instructor?: string;
  /** Day of the week */
  day: DayOfWeek;
  /** Start time in 24h format (HH:MM) or ISO time string, e.g. "08:10" or "08:10:00" */
  startTime: string;
  /** End time in 24h format (HH:MM) or ISO time string, e.g. "09:30" or "09:30:00" */
  endTime: string;
  /** Color theme for styling the spreadsheet block */
  color?: ColorTheme;
  /** Optional notes */
  notes?: string;
}

export interface WeekScheduleProps {
  /** Week identifier */
  weekNumber: 1 | 2;
  /** Display title, e.g. "Week 1 (Odd Weeks)" */
  title: string;
  /** Subtitle or description */
  subtitle?: string;
  /** List of course blocks scheduled for this week */
  courses: ScheduleBlock[];
  /** Earliest start hour on the grid (default: 8 = 8:00 AM) */
  startHour?: number;
  /** Latest end hour on the grid (default: 21 = 9:00 PM) */
  endHour?: number;
  /** Callback when user wants to remove or inspect a course */
  onRemoveCourse?: (courseId: string) => void;
  /** Callback to trigger the Add Course modal for this week */
  onAddCourse?: () => void;
  /** Accent color for this week's header/theme */
  accentColor?: "blue" | "purple" | "emerald" | "amber";
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
 * Formats an integer hour (8..21) into label ("8:00 AM", "12:00 PM", "9:00 PM")
 */
export function formatHourLabel(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

function formatScheduleType(description: string | null): string {
  if (!description) return "LEC";
  const lower = description.toLowerCase();
  if (lower === "lecture") return "LEC";
  if (lower === "laboratory" || lower === "lab") return "LAB";
  if (lower === "tutorial") return "TUT";
  if (lower === "seminar") return "SEM";
  return description;
}

/**
 * Utility to convert database `Section` results into schedule blocks for Week 1 or Week 2.
 */
export function convertSectionToScheduleBlocks(
  section: Section,
  color: ColorTheme = "blue",
): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = [];
  const seen = new Set<string>();
  const faculty = section.course_faculty?.find((f) => f.primary_indicator) ?? section.course_faculty?.[0];
  const meetings = section.course_meetings ?? [];
  const shortType = formatScheduleType(section.schedule_type_description);

  for (let i = 0; i < meetings.length; i++) {
    const meeting = meetings[i];
    if (!meeting.begin_time || !meeting.end_time) continue;

    const building = meeting.building ?? "";
    const room = meeting.room ?? "";
    const location = building && room.startsWith(building) ? room : [building, room].filter(Boolean).join(" ");

    const activeDays: DayOfWeek[] = [];
    if (meeting.monday) activeDays.push("monday");
    if (meeting.tuesday) activeDays.push("tuesday");
    if (meeting.wednesday) activeDays.push("wednesday");
    if (meeting.thursday) activeDays.push("thursday");
    if (meeting.friday) activeDays.push("friday");

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
        color,
      });
    }
  }

  return blocks;
}

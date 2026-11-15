/**
 * Shared academic-calendar date & week utilities for the Campus Map.
 * Safe for both Server and Client Components (no server-only imports).
 */

export const CAMPUS_MAP_MIN_DATE = "2026-09-01";
export const CAMPUS_MAP_MAX_DATE = "2027-04-30";

/** Monday of the week containing 2026-09-01 (Tue). */
export const CAMPUS_MAP_MIN_WEEK_START = "2026-08-31";
/** Monday of the week containing 2027-04-30 (Fri). */
export const CAMPUS_MAP_MAX_WEEK_START = "2027-04-26";

export const VALID_WEEKDAY_INDICES = [1, 2, 3, 4, 5, 6, 7] as const;

export const DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export const DAY_SHORT: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const LONG_MONTH_TO_NUM: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

export type AcademicDayStatus = {
  isHoliday: boolean;
  isReadingWeek: boolean;
  isMakeupFriday: boolean;
  isFallExamOrStudy: boolean;
  note?: string;
};

export type WeekDayInfo = {
  dayIndex: number; // 1 (Mon) .. 7 (Sun)
  date: string; // YYYY-MM-DD
  inBounds: boolean;
  note?: string;
  isHoliday: boolean;
  isReadingWeek: boolean;
  isMakeupFriday: boolean;
};

/** Strictly validates an ISO YYYY-MM-DD string and returns UTC Date at midnight, or null. */
export function parseIsoDateUtc(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [yStr, mStr, dStr] = iso.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

export function formatUtcDateToIso(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, deltaDays: number): string {
  const dt = parseIsoDateUtc(iso);
  if (!dt) return iso;
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return formatUtcDateToIso(dt);
}

/** Returns 1 (Monday) through 7 (Sunday) for a valid ISO date string. */
export function getDayOfWeekMon1(iso: string): number {
  const dt = parseIsoDateUtc(iso);
  if (!dt) return 1;
  const jsDay = dt.getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay;
}

/** Returns the Monday YYYY-MM-DD for the week containing `iso`. */
export function getMondayOfWeek(iso: string): string {
  const dayIndex = getDayOfWeekMon1(iso);
  return addDaysIso(iso, -(dayIndex - 1));
}

/** Clamps a weekStart (or any ISO date) to a valid Monday within [MIN_WEEK_START, MAX_WEEK_START]. */
export function clampWeekStart(input?: string | null): string {
  if (!input || !parseIsoDateUtc(input)) {
    return getDefaultCampusMapState().weekStart;
  }
  const mon = getMondayOfWeek(input);
  if (mon < CAMPUS_MAP_MIN_WEEK_START) return CAMPUS_MAP_MIN_WEEK_START;
  if (mon > CAMPUS_MAP_MAX_WEEK_START) return CAMPUS_MAP_MAX_WEEK_START;
  return mon;
}

export function isDateInMapBounds(iso: string): boolean {
  return iso >= CAMPUS_MAP_MIN_DATE && iso <= CAMPUS_MAP_MAX_DATE;
}

/** Returns current Toronto/Oshawa local date YYYY-MM-DD and minutes since midnight. */
export function getTorontoNowParts(now: Date = new Date()): {
  date: string;
  minutes: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const byType: Record<string, string> = {};
  for (const p of parts) {
    byType[p.type] = p.value;
  }
  const hour = Number(byType.hour ?? "12") % 24;
  const minute = Number(byType.minute ?? "0");
  const date = `${byType.year}-${byType.month}-${byType.day}`;
  return { date, minutes: hour * 60 + minute };
}

/**
 * Returns default initial weekStart, dayIndex (in bounds), and time slot clamped to [2026-09-01, 2027-04-30].
 */
export function getDefaultCampusMapState(now: Date = new Date()): {
  weekStart: string;
  dayIndex: number;
  date: string;
  slotStart: number;
} {
  const { date: torontoDate, minutes } = getTorontoNowParts(now);
  let date = torontoDate;
  if (date < CAMPUS_MAP_MIN_DATE) date = CAMPUS_MAP_MIN_DATE;
  if (date > CAMPUS_MAP_MAX_DATE) date = CAMPUS_MAP_MAX_DATE;

  const weekStart = clampWeekStart(date);
  const dayIndex = getDayOfWeekMon1(date);
  const rounded = Math.floor(minutes / 30) * 30;
  const slotStart = Math.max(480, Math.min(rounded, 1290));
  return { weekStart, dayIndex, date, slotStart };
}

/**
 * Academic-calendar exceptions verified against Ontario Tech Banner & Infosilem data
 * for the 2026-09-01 .. 2027-04-30 academic year.
 */
export function getAcademicDayStatus(iso: string): AcademicDayStatus {
  if (iso === "2026-10-12") {
    return {
      isHoliday: true,
      isReadingWeek: true,
      isMakeupFriday: false,
      isFallExamOrStudy: false,
      note: "Thanksgiving Day (Closed)",
    };
  }
  if (iso >= "2026-10-13" && iso <= "2026-10-16") {
    return {
      isHoliday: false,
      isReadingWeek: true,
      isMakeupFriday: false,
      isFallExamOrStudy: false,
      note: "Fall Reading Week",
    };
  }
  if (iso === "2026-12-08") {
    return {
      isHoliday: false,
      isReadingWeek: false,
      isMakeupFriday: false,
      isFallExamOrStudy: true,
      note: "Study Day (No regular classes)",
    };
  }
  if (iso >= "2026-12-09" && iso <= "2026-12-18") {
    return {
      isHoliday: false,
      isReadingWeek: false,
      isMakeupFriday: false,
      isFallExamOrStudy: true,
      note: "Fall Exam Period",
    };
  }
  if (iso >= "2026-12-19" && iso <= "2027-01-03") {
    return {
      isHoliday: false,
      isReadingWeek: false,
      isMakeupFriday: false,
      isFallExamOrStudy: false,
      note: "Winter Break",
    };
  }
  if (iso === "2027-02-15") {
    return {
      isHoliday: true,
      isReadingWeek: true,
      isMakeupFriday: false,
      isFallExamOrStudy: false,
      note: "Family Day (Closed)",
    };
  }
  if (iso >= "2027-02-16" && iso <= "2027-02-19") {
    return {
      isHoliday: false,
      isReadingWeek: true,
      isMakeupFriday: false,
      isFallExamOrStudy: false,
      note: "Winter Reading Week",
    };
  }
  if (iso === "2027-03-26") {
    return {
      isHoliday: true,
      isReadingWeek: false,
      isMakeupFriday: false,
      isFallExamOrStudy: false,
      note: "Good Friday (Closed)",
    };
  }
  if (iso === "2027-04-12") {
    return {
      isHoliday: false,
      isReadingWeek: false,
      isMakeupFriday: true,
      isFallExamOrStudy: false,
      note: "Friday Class Schedule (Good Friday Make-Up)",
    };
  }
  if (iso >= "2027-04-13" && iso <= CAMPUS_MAP_MAX_DATE) {
    return {
      isHoliday: false,
      isReadingWeek: false,
      isMakeupFriday: false,
      isFallExamOrStudy: false,
      note: iso === "2027-04-13" ? "Winter Study Day" : "Winter Post-Term / Exam Period",
    };
  }
  return {
    isHoliday: false,
    isReadingWeek: false,
    isMakeupFriday: false,
    isFallExamOrStudy: false,
  };
}

/** Builds the 7 Mon..Sun day entries for a given Monday `weekStart`. */
export function buildWeekDays(weekStart: string): WeekDayInfo[] {
  const days: WeekDayInfo[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysIso(weekStart, i);
    const inBounds = isDateInMapBounds(date);
    const status = getAcademicDayStatus(date);
    days.push({
      dayIndex: i + 1,
      date,
      inBounds,
      note: inBounds ? status.note : "Outside Sep 1 – Apr 30 range",
      isHoliday: status.isHoliday,
      isReadingWeek: status.isReadingWeek,
      isMakeupFriday: status.isMakeupFriday,
    });
  }
  return days;
}

/** Formats a short date like "Nov 16" without local TZ shift. */
export function formatShortIsoDate(iso: string): string {
  const dt = parseIsoDateUtc(iso);
  if (!dt) return iso;
  const mon = SHORT_MONTH_NAMES[dt.getUTCMonth()];
  const day = dt.getUTCDate();
  return `${mon} ${day}`;
}

/** Formats the visible Mon–Sun range label (clamped to [2026-09-01, 2027-04-30]). */
export function formatWeekRangeLabel(weekStart: string): string {
  const rawEnd = addDaysIso(weekStart, 6);
  const start = weekStart < CAMPUS_MAP_MIN_DATE ? CAMPUS_MAP_MIN_DATE : weekStart;
  const end = rawEnd > CAMPUS_MAP_MAX_DATE ? CAMPUS_MAP_MAX_DATE : rawEnd;
  const sDt = parseIsoDateUtc(start);
  const eDt = parseIsoDateUtc(end);
  if (!sDt || !eDt) return `${start} – ${end}`;
  const sMon = SHORT_MONTH_NAMES[sDt.getUTCMonth()];
  const eMon = SHORT_MONTH_NAMES[eDt.getUTCMonth()];
  const sDay = sDt.getUTCDate();
  const eDay = eDt.getUTCDate();
  const sYear = sDt.getUTCFullYear();
  const eYear = eDt.getUTCFullYear();
  if (sYear !== eYear) {
    return `${sMon} ${sDay}, ${sYear} – ${eMon} ${eDay}, ${eYear}`;
  }
  if (sMon === eMon) {
    return `${sMon} ${sDay} – ${eDay}, ${eYear}`;
  }
  return `${sMon} ${sDay} – ${eMon} ${eDay}, ${eYear}`;
}

/** Returns a concise term / milestone badge for the week. */
export function getWeekContextLabel(weekStart: string): string {
  const days = buildWeekDays(weekStart);
  const firstInBounds = days.find((d) => d.inBounds)?.date ?? weekStart;
  if (weekStart === "2026-10-12") return "Fall 2026 • Reading Week";
  if (weekStart === "2026-12-07") return "Fall 2026 • Classes End & Exams";
  if (weekStart === "2026-12-14") return "Fall 2026 • Exam Week";
  if (weekStart >= "2026-12-21" && weekStart <= "2026-12-28") return "Winter Break";
  if (weekStart === "2027-01-04") return "Winter 2027 • Pre-Term (Educ)";
  if (weekStart === "2027-02-15") return "Winter 2027 • Reading Week";
  if (weekStart === "2027-03-22") return "Winter 2027 • Good Friday Week";
  if (weekStart === "2027-04-12") return "Winter 2027 • Last Class & Post-Term";
  if (weekStart >= "2027-04-19") return "Winter 2027 • Exam / Post-Term";
  return firstInBounds < "2027-01-01" ? "Fall 2026" : "Winter 2027";
}

/** Parses library_study_rooms booking date strings like "Monday, November 16, 2026" to YYYY-MM-DD. */
export function parseLibraryDateToIso(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mm = LONG_MONTH_TO_NUM[m[1].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
}

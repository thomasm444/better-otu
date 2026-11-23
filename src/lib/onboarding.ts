import { MAX_START_YEAR, MIN_START_YEAR } from "@/lib/degree-planner";

export const ONBOARDING_COOKIE_NAME = "better_otu_onboarded";

export type YearOfStudy = 1 | 2 | 3 | 4;

export const YEAR_OF_STUDY_OPTIONS: readonly {
  value: YearOfStudy;
  label: string;
  title: string;
}[] = [
  { value: 1, label: "1", title: "1st Year" },
  { value: 2, label: "2", title: "2nd Year" },
  { value: 3, label: "3", title: "3rd Year" },
  { value: 4, label: "4+", title: "4th Year+" },
] as const;

/**
 * Returns the fall start year of the current academic cycle.
 * Jan–Apr belong to the academic year that started in the previous calendar year.
 */
export function getCurrentAcademicStartYear(now: Date = new Date()): number {
  const academicYear =
    now.getMonth() < 4 ? now.getFullYear() - 1 : now.getFullYear();
  return Math.max(MIN_START_YEAR, Math.min(MAX_START_YEAR, academicYear));
}

/**
 * Converts a student's year of study (1, 2, 3, or 4+) into their default
 * Degree Planner start year (e.g., Year 2 in 2026–27 -> start year 2025).
 */
export function yearOfStudyToStartYear(
  yearOfStudy: YearOfStudy | number | null | undefined,
  nowOrBaseYear?: Date | number,
): number {
  const base =
    typeof nowOrBaseYear === "number"
      ? Math.max(MIN_START_YEAR, Math.min(MAX_START_YEAR, nowOrBaseYear))
      : getCurrentAcademicStartYear(nowOrBaseYear ?? new Date());
  if (!yearOfStudy) return base;
  const clamped = Math.max(1, Math.min(4, Math.trunc(yearOfStudy)));
  return Math.max(
    MIN_START_YEAR,
    Math.min(MAX_START_YEAR, base - (clamped - 1)),
  );
}

export function formatYearOfStudy(
  year: number | null | undefined,
): string | null {
  if (year === 1) return "Year 1";
  if (year === 2) return "Year 2";
  if (year === 3) return "Year 3";
  if (year === 4) return "Year 4+";
  return null;
}

export function hasResolvedOnboarding(
  profile:
    | {
        onboarding_completed_at?: string | null;
        onboarding_skipped_at?: string | null;
      }
    | null
    | undefined,
): boolean {
  return Boolean(
    profile?.onboarding_completed_at || profile?.onboarding_skipped_at,
  );
}

export function getSafeNextPath(rawNext: string | null | undefined): string {
  if (
    !rawNext ||
    !rawNext.startsWith("/") ||
    rawNext.startsWith("//") ||
    rawNext === "/login" ||
    rawNext.startsWith("/login?") ||
    rawNext.startsWith("/onboarding")
  ) {
    return "/";
  }
  return rawNext;
}

export function buildOnboardingCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === "production",
  };
}

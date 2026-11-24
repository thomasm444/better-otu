import type { SupabaseClient } from "@supabase/supabase-js";

export type CourseStatus =
  | "planned"
  | "enrolled"
  | "in_progress"
  | "completed"
  | "dropped";

export interface StudentProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  year_of_study: 1 | 2 | 3 | 4 | null;
  degree_program_id: string | null;
  has_minor: boolean | null;
  minor_program_id: string | null;
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileProgramSummary {
  program_id: string;
  name: string;
  catalog_year: string;
  credential: string | null;
  degree: string | null;
  degree_abbrev: string | null;
  faculty: string | null;
}

export interface StudentProfileWithPrograms extends StudentProfile {
  degree_program: ProfileProgramSummary | null;
  minor_program: ProfileProgramSummary | null;
}

export interface StudentCourse {
  id: string;
  user_id: string;
  course_code: string;
  selected_crn: string | null;
  semester: string;
  status: CourseStatus;
  grade: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertStudentCourseInput {
  course_code: string;
  selected_crn?: string | null;
  semester: string;
  status?: CourseStatus;
  grade?: string | null;
}

export interface UpdateStudentCourseInput {
  selected_crn?: string | null;
  semester?: string;
  status?: CourseStatus;
  grade?: string | null;
}

function normalizeCourseCode(code: string): string {
  return code.trim().toUpperCase();
}

async function resolveUserId(
  supabase: SupabaseClient,
  userId?: string,
): Promise<string | null> {
  if (userId) return userId;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;
  return user.id;
}

const PROFILE_CACHE_TTL_MS = 15_000;
const profileCache = new Map<
  string,
  { value: StudentProfile | null; expiresAt: number }
>();
const profileInFlight = new Map<string, Promise<StudentProfile | null>>();
const profileWithProgramsCache = new Map<
  string,
  { value: StudentProfileWithPrograms | null; expiresAt: number }
>();
const profileWithProgramsInFlight = new Map<
  string,
  Promise<StudentProfileWithPrograms | null>
>();

export function invalidateStudentProfileCache(userId?: string): void {
  if (userId) {
    profileCache.delete(userId);
    profileWithProgramsCache.delete(userId);
    return;
  }
  profileCache.clear();
  profileWithProgramsCache.clear();
}

export async function fetchStudentProfile(
  supabase: SupabaseClient,
  userId?: string,
): Promise<StudentProfile | null> {
  const resolvedUserId = await resolveUserId(supabase, userId);
  if (!resolvedUserId) return null;

  const cached = profileCache.get(resolvedUserId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const inFlight = profileInFlight.get(resolvedUserId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", resolvedUserId)
      .maybeSingle();

    if (error) throw error;
    const value = data as StudentProfile | null;
    profileCache.set(resolvedUserId, {
      value,
      expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
    });
    return value;
  })().finally(() => {
    profileInFlight.delete(resolvedUserId);
  });

  profileInFlight.set(resolvedUserId, promise);
  return promise;
}

function normalizeJoinedProgram(
  raw: ProfileProgramSummary | ProfileProgramSummary[] | null | undefined,
): ProfileProgramSummary | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export async function fetchStudentProfileWithPrograms(
  supabase: SupabaseClient,
  userId?: string,
): Promise<StudentProfileWithPrograms | null> {
  const resolvedUserId = await resolveUserId(supabase, userId);
  if (!resolvedUserId) return null;

  const cached = profileWithProgramsCache.get(resolvedUserId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const inFlight = profileWithProgramsInFlight.get(resolvedUserId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        `
        *,
        degree_program:degree_programs!profiles_degree_program_id_fkey (
          program_id,
          name,
          catalog_year,
          credential,
          degree,
          degree_abbrev,
          faculty
        ),
        minor_program:degree_programs!profiles_minor_program_id_fkey (
          program_id,
          name,
          catalog_year,
          credential,
          degree,
          degree_abbrev,
          faculty
        )
      `,
      )
      .eq("id", resolvedUserId)
      .maybeSingle();

    if (error) throw error;

    let value: StudentProfileWithPrograms | null = null;
    if (data) {
      const row = data as StudentProfile & {
        degree_program?: ProfileProgramSummary | ProfileProgramSummary[] | null;
        minor_program?: ProfileProgramSummary | ProfileProgramSummary[] | null;
      };
      value = {
        ...row,
        degree_program: normalizeJoinedProgram(row.degree_program),
        minor_program: normalizeJoinedProgram(row.minor_program),
      };
    }

    profileWithProgramsCache.set(resolvedUserId, {
      value,
      expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
    });
    return value;
  })().finally(() => {
    profileWithProgramsInFlight.delete(resolvedUserId);
  });

  profileWithProgramsInFlight.set(resolvedUserId, promise);
  return promise;
}

export async function fetchStudentCourses(
  supabase: SupabaseClient,
  semester?: string,
): Promise<StudentCourse[]> {
  let query = supabase
    .from("student_courses")
    .select("*")
    .order("semester", { ascending: true })
    .order("course_code", { ascending: true });

  if (semester) {
    query = query.eq("semester", semester);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as StudentCourse[];
}

export async function upsertStudentCourse(
  supabase: SupabaseClient,
  input: UpsertStudentCourseInput,
  userId?: string,
): Promise<StudentCourse> {
  const resolvedUserId = await resolveUserId(supabase, userId);

  if (!resolvedUserId) {
    throw new Error("You must be signed in to save courses.");
  }

  const payload = {
    user_id: resolvedUserId,
    course_code: normalizeCourseCode(input.course_code),
    selected_crn: input.selected_crn ?? null,
    semester: input.semester.trim(),
    status: input.status ?? "planned",
    grade: input.grade ?? null,
  };

  const { data, error } = await supabase
    .from("student_courses")
    .upsert(payload, { onConflict: "user_id,course_code,semester" })
    .select("*")
    .single();

  if (error) throw error;
  return data as StudentCourse;
}

export async function updateStudentCourse(
  supabase: SupabaseClient,
  id: string,
  updates: UpdateStudentCourseInput,
): Promise<StudentCourse> {
  const { data, error } = await supabase
    .from("student_courses")
    .update({
      ...(updates.selected_crn !== undefined && {
        selected_crn: updates.selected_crn,
      }),
      ...(updates.semester !== undefined && {
        semester: updates.semester.trim(),
      }),
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.grade !== undefined && { grade: updates.grade }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as StudentCourse;
}

export async function removeStudentCourse(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("student_courses").delete().eq("id", id);
  if (error) throw error;
}

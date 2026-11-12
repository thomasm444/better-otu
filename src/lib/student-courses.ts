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
  created_at: string;
  updated_at: string;
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

export async function fetchStudentProfile(
  supabase: SupabaseClient,
): Promise<StudentProfile | null> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  return data as StudentProfile | null;
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
): Promise<StudentCourse> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("You must be signed in to save courses.");
  }

  const payload = {
    user_id: user.id,
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

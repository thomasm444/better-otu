import type { SupabaseClient } from "@supabase/supabase-js";

import type { CustomCourse, PlannerTerm } from "@/lib/degree-types";

export interface DegreePlanRecord {
  id: string;
  user_id: string;
  user_email: string;
  program_id: string;
  terms: PlannerTerm[];
  customs: CustomCourse[];
  created_at: string;
  updated_at: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function fetchLatestDegreePlan(
  supabase: SupabaseClient,
  userEmail: string,
): Promise<DegreePlanRecord | null> {
  const { data, error } = await supabase
    .from("degree_plans")
    .select("*")
    .eq("user_email", normalizeEmail(userEmail))
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as DegreePlanRecord | null;
}

export async function fetchDegreePlanByProgram(
  supabase: SupabaseClient,
  userEmail: string,
  programId: string,
): Promise<DegreePlanRecord | null> {
  const { data, error } = await supabase
    .from("degree_plans")
    .select("*")
    .eq("user_email", normalizeEmail(userEmail))
    .eq("program_id", programId)
    .maybeSingle();

  if (error) throw error;
  return data as DegreePlanRecord | null;
}

export async function upsertDegreePlan(
  supabase: SupabaseClient,
  params: {
    userId: string;
    userEmail: string;
    programId: string;
    terms: PlannerTerm[];
    customs: CustomCourse[];
  },
): Promise<DegreePlanRecord> {
  const { data, error } = await supabase
    .from("degree_plans")
    .upsert(
      {
        user_id: params.userId,
        user_email: normalizeEmail(params.userEmail),
        program_id: params.programId,
        terms: params.terms,
        customs: params.customs,
      },
      { onConflict: "user_email,program_id" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as DegreePlanRecord;
}

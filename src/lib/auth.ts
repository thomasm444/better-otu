"use client";

import { getSafeNextPath } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/client";

export const ONTARIO_TECH_DOMAIN = "ontariotechu.net";

export function isOntarioTechEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().trim().endsWith(`@${ONTARIO_TECH_DOMAIN}`);
}

/**
 * Initiates Google OAuth via Supabase, restricting the Google account chooser
 * to @ontariotechu.net Workspace accounts via `hd: "ontariotechu.net"`.
 */
export async function signInWithOntarioTechGoogle(nextPath?: string) {
  const supabase = createClient();
  const safeNext = getSafeNextPath(
    nextPath ??
      (typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/"),
  );

  const callbackUrl = new URL("/auth/callback", window.location.origin);
  if (safeNext !== "/") {
    callbackUrl.searchParams.set("next", safeNext);
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
      queryParams: {
        hd: ONTARIO_TECH_DOMAIN,
        prompt: "select_account",
      },
    },
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function signOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

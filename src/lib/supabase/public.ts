import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Cookie-less anon client for public, read-only data.
 *
 * Use this inside `'use cache'` functions: those must not read cookies, and the
 * course catalogue is public anyway (RLS grants SELECT to anon).
 */
let client: ReturnType<typeof createClient> | null = null;

export function getPublicClient() {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  return client;
}

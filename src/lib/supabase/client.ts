"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components ("use client").
 *
 * Safe to call from multiple components: createBrowserClient reuses a single
 * underlying client per browser tab.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

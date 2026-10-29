import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-key client. Bypasses RLS, so it must never be reachable from the
 * browser — the `server-only` import above makes the build fail if a Client
 * Component ever imports this file.
 *
 * Use it for writes / bulk ingest only. Reads should go through the anon
 * client in ./server.ts so RLS still applies.
 */
export function createAdminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

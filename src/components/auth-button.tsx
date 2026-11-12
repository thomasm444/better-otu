"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { signInWithOntarioTechGoogle, signOut } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

export function AuthButton() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;

      // Surface OAuth or domain-restriction errors redirected from /auth/callback.
      const url = new URL(window.location.href);
      const authError = url.searchParams.get("auth_error");
      if (authError) {
        setErrorMessage(authError);
        url.searchParams.delete("auth_error");
        window.history.replaceState({}, "", url.toString());
      }

      setUser(data.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSignIn() {
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await signInWithOntarioTechGoogle();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to start Google sign-in.",
      );
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await signOut();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to sign out.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    user?.email ??
    "Student";

  return (
    <div className="flex flex-col items-end gap-2">
      {loading ? (
        <div className="h-9 w-48 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      ) : user ? (
        <div className="flex items-center gap-3 rounded-xl border border-black/[.08] bg-white px-3 py-1.5 shadow-xs dark:border-white/[.12] dark:bg-zinc-900">
          <div className="text-right">
            <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
              {displayName}
            </p>
            {user.email && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {user.email}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={submitting}
            className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {submitting ? "Signing out..." : "Sign out"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSignIn}
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium text-zinc-900 shadow-xs transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            viewBox="0 0 24 24"
          >
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.09.73-2.48 1.16-4.22 1.16-3.24 0-5.99-2.19-6.97-5.13H1.04v3.14C3.05 21.14 7.21 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.03 14.02c-.25-.73-.39-1.51-.39-2.32s.14-1.59.39-2.32V6.24H1.04A11.98 11.98 0 0 0 0 11.7c0 1.93.46 3.76 1.04 5.46l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.65c1.8 0 3.41.62 4.68 1.83l3.51-3.51C18.07 1.09 15.3 0 12 0 7.21 0 3.05 2.86 1.04 7.06l3.99 3.14c.98-2.94 3.73-5.13 6.97-5.13Z"
            />
          </svg>
          {submitting ? "Redirecting..." : "Sign in with @ontariotechu.net"}
        </button>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="font-semibold hover:underline"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

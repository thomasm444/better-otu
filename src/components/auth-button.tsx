"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { signInWithOntarioTechGoogle, signOut } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

export function AuthButton() {
  const router = useRouter();
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
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);

      if (event === "SIGNED_OUT" && window.location.pathname !== "/login") {
        router.replace("/login");
        router.refresh();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

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
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to sign out.",
      );
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
          <Link
            href="/profile"
            className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Profile
          </Link>
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

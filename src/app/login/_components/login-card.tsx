"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { signInWithOntarioTechGoogle } from "@/lib/auth";

export function LoginCard() {
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState<string>("/");

  useEffect(() => {
    // Schedule URL inspection in a microtask to avoid synchronous setState in effect.
    void Promise.resolve().then(() => {
      const url = new URL(window.location.href);
      const next = url.searchParams.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        setNextPath(next);
      }

      const authError = url.searchParams.get("auth_error");
      if (authError) {
        setErrorMessage(authError);
        url.searchParams.delete("auth_error");
        window.history.replaceState({}, "", url.toString());
      }
    });
  }, []);

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await signInWithOntarioTechGoogle(nextPath);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to start Google sign-in.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-200/90 bg-white p-8 shadow-xl shadow-zinc-200/60 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40">
      {/* Brand / Header */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold tracking-tight text-white shadow-sm">
          OTU
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Sign in to Better OTU
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
          Ontario Tech University Student Portal
        </p>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="shrink-0 font-semibold hover:underline"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Google Sign-In Action */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-900 shadow-xs transition-all hover:border-zinc-400 hover:bg-zinc-50 focus:ring-2 focus:ring-blue-500/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
      >
        <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
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
        <span>
          {submitting
            ? "Redirecting to Google..."
            : "Continue with @ontariotechu.net Google"}
        </span>
      </button>

      {/* Info Divider */}
      <div className="mt-6 border-t border-zinc-100 pt-5 text-center dark:border-zinc-800">
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Access is restricted to{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            @ontariotechu.net
          </span>{" "}
          accounts. Your course schedules and degree plans are saved securely to
          your student profile.
        </p>
        <p className="mt-2.5">
          <Link
            href="/privacy-policy"
            className="text-[11px] font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:decoration-zinc-700 dark:hover:text-zinc-200"
          >
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
